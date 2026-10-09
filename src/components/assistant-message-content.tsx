import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { normalizeAssistantMarkdown } from "@/components/assistant-markdown";

const plugins = [remarkGfm];

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
        a: ({ href, children }) => href
          ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          : <span>{children}</span>,
        img: ({ alt }) => <span>{alt}</span>,
        table: ({ children }) => <div className="assistant-table-scroll" role="region" aria-label="Answer table" tabIndex={0}><table>{children}</table></div>,
      }}>{normalizeAssistantMarkdown(text)}</Markdown>
    </div>
  );
}
