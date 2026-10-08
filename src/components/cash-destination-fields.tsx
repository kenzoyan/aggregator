import { useId } from "react";

import type { CashDestination } from "@/domain/portfolio/types";

export function CashDestinationFields({ destination, onChange, names, externalOnly = false, accountName, chinese = false, compact = false }: {
  destination: CashDestination;
  onChange: (destination: CashDestination) => void;
  names: readonly string[];
  externalOnly?: boolean;
  accountName?: string;
  chinese?: boolean;
  compact?: boolean;
}) {
  const listId = useId();
  const radioName = `${listId}-destination`;
  const investmentAccount = accountName ?? (chinese ? "当前投资账户" : "this investment account");
  return <div className="cash-destination-fields">
    {!externalOnly && compact && <label>Keep or withdraw
      <select value={destination.kind} onChange={(event) => onChange(event.target.value === "investment-account" ? { kind: "investment-account" } : { kind: "external-account", name: "" })}>
        <option value="investment-account">Keep in {investmentAccount}</option>
        <option value="external-account">Withdraw to an external account</option>
      </select>
    </label>}
    {!externalOnly && !compact && <fieldset className="cash-destination-options">
      <legend>{chinese ? "卖出的钱收到哪里？" : "Where will you receive the money?"}</legend>
      <label className="cash-destination-option">
        <input type="radio" name={radioName} checked={destination.kind === "investment-account"} onChange={() => onChange({ kind: "investment-account" })} />
        <span><strong>{chinese ? `留在${investmentAccount}` : `Keep in ${investmentAccount}`}</strong>
          <small>{chinese ? "计入本应用的投资组合总额。" : "Stays in your portfolio total as account cash."}</small></span>
      </label>
      <label className="cash-destination-option">
        <input type="radio" name={radioName} checked={destination.kind === "external-account"} onChange={() => onChange({ kind: "external-account", name: "" })} />
        <span><strong>{chinese ? "收到我的银行或其他外部账户" : "Receive in my bank or other external account"}</strong>
          <small>{chinese ? "立即从本应用的投资组合总额中移出。" : "Leaves your tracked portfolio total immediately."}</small></span>
      </label>
    </fieldset>}
    {destination.kind === "external-account" && <label className="cash-destination-name">{chinese ? "收款账户名称" : compact ? "Withdraw to (account name)" : "Which account will receive it?"}
      <input required maxLength={100} list={listId} placeholder={chinese ? "例如：我的银行卡" : "e.g. My bank account"} value={destination.name} onChange={(event) => onChange({ kind: "external-account", name: event.target.value })} />
      <datalist id={listId}>{names.map((name) => <option key={name} value={name} />)}</datalist>
      {!compact && <small>{chinese ? "只记录名称，不需要账号，也不追踪账户余额。" : "A name only. No account number or bank balance needed."}</small>}
    </label>}
  </div>;
}
