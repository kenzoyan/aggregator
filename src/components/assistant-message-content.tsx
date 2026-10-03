import type { ReactNode } from "react";

function inlineContent(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part,
  );
}

const bullet = /^\s*[-*]\s+(.+)$/;
const numbered = /^\s*\d+\.\s+(.+)$/;

export function AssistantMessageContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index]?.trim()) { index += 1; continue; }
    const listPattern = bullet.test(lines[index]!) ? bullet
      : numbered.test(lines[index]!) ? numbered : undefined;
    if (listPattern) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const match = listPattern.exec(lines[index]!);
        if (!match) break;
        items.push(<li key={index}>{inlineContent(match[1]!)}</li>);
        index += 1;
      }
      blocks.push(listPattern === numbered
        ? <ol key={`list-${index}`}>{items}</ol>
        : <ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]?.trim() &&
      !bullet.test(lines[index]!) && !numbered.test(lines[index]!)) {
      paragraph.push(lines[index]!.replace(/^#{1,3}\s+/, ""));
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineContent(paragraph.join("\n"))}</p>);
  }
  return <div className="assistant-rich-text">{blocks}</div>;
}
