import { createHash, randomUUID } from "node:crypto";
import type { PortfolioAnalystDraftTools } from "@/application/portfolio-analyst-agent";
import { attachPortfolioAnalystImport, appendPortfolioAnalystTurn, type PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { prepareScreenshotImport } from "@/application/imports/screenshot-import-preparation";
import { detectedSourceProvider } from "@/application/imports/vision-extractor";
import { screenshotExtractionSchema } from "@/application/imports/vision-extraction-contract";
import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createPortfolioSaleHandlers } from "@/server/portfolio-sale-handlers";
import { createImportMessageHandler } from "@/app/api/portfolio/analyst/import-message/handler";
import { createImportWorkflowResult } from "@/application/imports/import-workflow-result";
import { createImportDraftReviewHandler } from "@/app/api/imports/[id]/review/handler";
import { createImportDraftReadModel, createImportDraftConfirmationPayload } from "@/application/imports/import-draft-read-model";
import { applyImportDraftEdit } from "@/application/imports/import-review-editor";
import { z } from "zod";
import type { ImportMessageDecision } from "@/application/imports/import-message-intent";

/** Exposes draft operations only. confirmSale is reachable solely through the UI's PUT confirmation. */
export function createPortfolioDraftTools(database: PortfolioDatabase, conversationId: string, userTurnId: string, imageSourceTurnId?: string,
  handlers = createPortfolioSaleHandlers(database, false), importDraftId?: string): PortfolioAnalystDraftTools {
  let resultTurnId: string | undefined;
  const resultTurnIds: string[] = [];
  let changed = false;
  const current = () => {
    const conversation = database.readPortfolioAnalystConversation(conversationId);
    if (!conversation || database.readLatestPortfolioAnalystConversation()?.id !== conversationId) throw new Error("Current conversation was not found.");
    return conversation;
  };
  const record = (conversation: PortfolioAnalystConversation, result: PortfolioWorkflowResult) => {
    resultTurnId = randomUUID();
    resultTurnIds.push(resultTurnId);
    database.savePortfolioAnalystConversation(appendPortfolioAnalystTurn(conversation, {
      id: resultTurnId, question: "", createdAt: result.recordedAt,
      chat: { assistantText: "", requestStatus: "pending", workflowResult: result },
    }));
    return result;
  };
  const initial = current();
  const activeImport = () => current().importActivities.findLast((activity) => (!importDraftId || activity.draftId === importDraftId) &&
    !activity.cancelledAt && database.getImportDraft(activity.draftId)?.status === "draft");
  return {
    pending: { sale: initial.turns.some((turn) => turn.chat?.saleDraft?.status === "pending"), importAccount: activeImport()?.targetLabel, hasImage: initial.turns.some((turn) => Boolean(turn.attachments?.length)) },
    resultTurnId: () => resultTurnId,
    resultTurnIds: () => resultTurnIds,
    async execute(name, signal, args = {}) {
      signal?.throwIfAborted();
      const conversation = current();
      if (name === "prepare_import_draft") {
        const fail = (code: string) => record(conversation, { workflow: "import", operation: "prepare", status: "failed",
          recordedAt: new Date().toISOString(), portfolioChanged: false, code });
        if (changed) return fail("operation-already-performed");
        const account = database.readSourceAccounts().find((item) => item.id === args.accountId);
        if (!account || account.updateMethod !== "screenshot") return fail("screenshot-account-required");
        const source = conversation.turns.find((turn) => turn.id === args.sourceTurnId);
        if (!args.imageIds?.length || new Set(args.imageIds).size !== args.imageIds.length ||
          args.imageIds.some((id) => !source?.attachments?.some((attachment) => attachment.id === id))) return fail("image-not-found");
        const extraction = screenshotExtractionSchema.parse(args.holdings);
        const detectedProvider = detectedSourceProvider(extraction.accountName);
        const selectedProvider = account.provider === "generic" ? detectedSourceProvider(account.accountType) ?? detectedSourceProvider(account.label) : account.provider;
        if (detectedProvider && selectedProvider && detectedProvider !== selectedProvider) {
          extraction.confidence = "low";
          extraction.warnings = [...extraction.warnings.slice(0, 19), `The screenshot account ${extraction.accountName} may not match ${account.label}. Verify the selected account before confirming.`];
        }
        const id = `image-import-${createHash("sha256").update(JSON.stringify([conversationId, account.id, [...args.imageIds].sort()])).digest("hex").slice(0, 32)}`;
        let draft = database.getImportDraft(id);
        if (draft?.status === "confirmed") return fail("image-already-imported");
        if (draft?.status === "discarded") return fail("image-import-cancelled");
        if (!draft) {
          database.saveImportDraft(prepareScreenshotImport({ draftId: id, snapshotId: randomUUID(), sourceAccountId: account.id,
            createdAt: new Date().toISOString(), extraction }));
          draft = database.getImportDraft(id)!;
        }
        const linked = conversation.importActivities.some((activity) => activity.draftId === id) ? conversation
          : attachPortfolioAnalystImport(conversation, { draftId: id, sourceTurnId: source!.id, targetLabel: account.label,
            submissionText: conversation.turns.find((turn) => turn.id === userTurnId)?.question ?? "",
            screenshotCount: args.imageIds.length, createdAt: new Date().toISOString() });
        changed = true;
        return record(linked, createImportWorkflowResult({ draft, accountName: account.label,
          operation: "prepare", status: "succeeded", recordedAt: new Date().toISOString() }));
      }
      if (name.endsWith("import_draft")) {
        const activity = activeImport();
        const draft = activity && database.getImportDraft(activity.draftId);
        if (!activity || !draft) return record(conversation, { workflow: "import", operation: "review", status: "failed",
          recordedAt: new Date().toISOString(), portfolioChanged: false, code: "no-pending-import" });
        if (name === "read_import_draft" || name === "review_import_draft") return record(conversation, createImportWorkflowResult({
          draft, accountName: activity.targetLabel, operation: "review", status: "succeeded", recordedAt: new Date().toISOString(),
        }));
        if (changed) return record(conversation, createImportWorkflowResult({ draft, accountName: activity.targetLabel,
          operation: "update", status: "failed", recordedAt: new Date().toISOString(), code: "operation-already-performed" }));
        if (name === "update_import_draft" && args.importEdit &&
          !["valuation-date", "price-date", "instrument-code"].includes(args.importEdit.field)) {
          const edit = z.object({ field: z.enum(["quantity", "costBasis", "displayName", "currency", "observedPrice", "reportedPriorReturn", "reportedMarketValue", "averageCost"]),
            value: z.string().max(200), holdingLineId: z.string().min(1).max(100) }).parse(args.importEdit);
          const model = createImportDraftReadModel(draft);
          const index = model.portfolio.holdings.findIndex((holding) => holding.lineId === edit.holdingLineId);
          if (index < 0) return record(conversation, createImportWorkflowResult({ draft, accountName: activity.targetLabel,
            operation: "update", status: "failed", recordedAt: new Date().toISOString(), code: "holding-not-found" }));
          const updated = applyImportDraftEdit(model, { type: "update-holding", index, field: edit.field, value: edit.value });
          const response = await createImportDraftReviewHandler(database)(new Request("http://localhost/api/imports/review", {
            method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(createImportDraftConfirmationPayload(updated)), signal,
          }), draft.id);
          changed = response.ok;
          return record(current(), createImportWorkflowResult({ draft: database.getImportDraft(draft.id)!, accountName: activity.targetLabel,
            operation: "update", status: response.ok ? "succeeded" : "failed", recordedAt: new Date().toISOString(),
            ...(response.ok ? {} : { code: "draft-save-failed" }) }));
        }
        const source = conversation.turns.find((turn) => turn.id === userTurnId);
        const edit = name === "update_import_draft" ? z.object({
          field: z.enum(["valuation-date", "price-date", "instrument-code"]), value: z.string().min(1).max(100),
          holdingLineId: z.string().max(200).optional(),
        }).parse(args.importEdit) : undefined;
        const decision: ImportMessageDecision = edit ? edit.field === "instrument-code"
          ? { intent: "set-code", value: edit.value, holdingLineId: edit.holdingLineId }
          : { intent: "set-date", field: edit.field, value: edit.value, holdingLineId: edit.holdingLineId }
          : { intent: "cancel" };
        const interpreter = { interpret: async () => decision };
        const response = await createImportMessageHandler({ database, interpreter, allowConfirmation: false })(new Request(
          "http://localhost/api/portfolio/analyst/import-message", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: randomUUID(), conversationId, draftId: draft.id, message: source?.userText ?? source?.question ?? "" }), signal,
          }));
        const payload = await response.json();
        const created = current().turns.findLast((turn) => !conversation.turns.some((prior) => prior.id === turn.id) && turn.chat?.workflowResult);
        if (created?.chat?.workflowResult) {
          resultTurnId = created.id; resultTurnIds.push(created.id);
          changed = created.chat.workflowResult.status === "succeeded";
          return created.chat.workflowResult;
        }
        return record(current(), createImportWorkflowResult({ draft, accountName: activity.targetLabel, operation: "update",
          status: "failed", recordedAt: new Date().toISOString(), code: payload.delegate ? "clarification-required" : "operation-failed" }));
      }
      const pending = conversation.turns.findLast((turn) => turn.chat?.saleDraft?.status === "pending");
      const result = (status: "succeeded" | "failed", details?: string): PortfolioWorkflowResult => ({
        workflow: "sale", operation: name === "prepare_sale_draft" ? "prepare" : name === "cancel_sale_draft" ? "cancel" : name === "update_sale_draft" ? "update" : "review",
        status, recordedAt: new Date().toISOString(), portfolioChanged: false,
        ...(details ? { details } : {}), ...(pending?.chat?.saleDraft ? { draft: pending.chat.saleDraft.fields, warnings: pending.chat.saleDraft.extraction.warnings } : {}),
      });
      // A repeated model call must not repeat an edit or create another draft in the same turn.
      if (changed && name !== "read_sale_draft" && name !== "review_sale_draft") return record(conversation, result("failed", "A draft operation has already been performed in this turn. Inspect or review the current draft."));
      if (name === "read_sale_draft") return record(conversation, result(pending ? "succeeded" : "failed", pending ? undefined : "No pending sale draft exists."));
      if (name !== "prepare_sale_draft" && !pending) return record(conversation, result("failed", "No pending sale draft exists."));
      const method = name === "prepare_sale_draft" ? "POST" : name === "review_sale_draft" ? "PUT" : "PATCH";
      const source = conversation.turns.find((turn) => turn.id === userTurnId);
      // Attached images are owned by the conversation. The model cannot choose arbitrary paths or images.
      const selectedSourceId = args.sourceTurnId ?? (args.sale ? undefined : imageSourceTurnId);
      const imageSource = selectedSourceId ? conversation.turns.find((turn) => turn.id === selectedSourceId && turn.attachments?.length) : undefined;
      if (selectedSourceId && !imageSource) return record(conversation, result("failed", "The saved image was not found in this conversation."));
      const text = source?.userText ?? source?.question ?? "";
      const requestBody = name === "prepare_sale_draft"
        ? { conversationId, sourceTurnId: imageSource?.id ?? userTurnId, ...(!imageSource ? { textOnly: true } : {}), ...(args.sale ? { extraction: args.sale } : {}), ...(args.imageIds ? { imageIds: args.imageIds } : {}), ...(args.accountId ? { accountId: args.accountId } : {}) }
        : name === "review_sale_draft" ? { conversationId, turnId: pending!.id, confirm: false }
        : { conversationId, turnId: pending!.id, ...(name === "cancel_sale_draft" ? { cancel: true } : args.fields ? { fields: args.fields } : { text }) };
      const response = await handlers[method](new Request("http://localhost/api/portfolio/analyst/sale", {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody), signal,
      }));
      const payload = await response.json();
      const latest = current();
      const created = latest.turns.findLast((turn) => !conversation.turns.some((prior) => prior.id === turn.id) && turn.chat?.workflowResult);
      if (created?.chat?.workflowResult) {
        resultTurnId = created.id;
        resultTurnIds.push(created.id);
        changed = changed || created.chat.workflowResult.status === "succeeded";
        return created.chat.workflowResult;
      }
      if (name === "update_sale_draft" && response.ok && args.fields) {
        changed = true;
        return record(latest, { ...result("succeeded"), draft: args.fields });
      }
      if (name === "review_sale_draft" && response.ok && payload.preview) {
        return record(latest, { ...result("succeeded"), preview: {
          netProceeds: payload.preview.netProceeds, realizedResult: payload.preview.saleResult,
          quantity: payload.quantity, estimatedQuantity: payload.estimatedQuantity, possibleDuplicate: payload.possibleDuplicate,
        } });
      }
      if (name === "prepare_sale_draft" && response.ok && pending) return record(latest, result("succeeded", "A pending draft already exists. Inspect it or update it."));
      return record(latest, result("failed", payload.error ?? "The draft operation could not be completed."));
    },
  };
}
