import Markdown from "react-markdown";
import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";

import { normalizeAssistantMarkdown } from "@/components/assistant-markdown";

/** Remove internal tool citations from prose, leaving links and code untouched.
 * Apply at rendering time so saved reports retain their original evidence.
 */
function hideInternalEvidenceCitations() {
  return (tree: Root) => {
    function visit(node: Nodes) {
      if (["link", "linkReference", "image", "imageReference", "code", "inlineCode"].includes(node.type)) return;
      if (node.type === "text") {
        node.value = node.value
          .replace(/\[\s*call\d+\.[\w.-]+(?:[\s,;]+call\d+\.[\w.-]+)*\s*\]/g, "")
          // Streaming may stop before the closing bracket arrives.
          .replace(/\[\s*call\d+\.[\w.-]*(?:[\s,;]+call\d+\.[\w.-]*)*[\s,;]*$/, "");
      }
      if ("children" in node) {
        node.children.forEach(visit);
        node.children = node.children.filter((child) => !(child.type === "paragraph" &&
          child.children.every((part) => part.type === "text" && !part.value.trim())));
      }
    }
    visit(tree);
  };
}

const plugins = [remarkGfm, hideInternalEvidenceCitations];

/** Render model text without interpreting raw HTML or loading remote images. */
export function AssistantMessageContent({ text }: { text: string }) {
  return (
    <div className="assistant-rich-text">
      <Markdown remarkPlugins={plugins} components={{
        h1: ({ children }) => <h3>{children}</h3>,
        h2: ({ children }) => <h3>{children}</h3>,
        h3: ({ children }) => <h4>{children}</h4>,
        h4: ({ children }) => <h4>{children}</h4>,
        h5: ({ children }) => <h4>{children}</h4>,
        h6: ({ children }) => <h4>{children}</h4>,
        a: ({ href, children }) => href && /^https?:\/\//i.test(href)
          ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          : <span>{children}</span>,
        img: ({ alt }) => <span>{alt}</span>,
        table: ({ children }) => <div className="assistant-table-scroll" role="region" aria-label="Answer table" tabIndex={0}><table>{children}</table></div>,
      }}>{normalizeAssistantMarkdown(text)}</Markdown>
    </div>
  );
}
