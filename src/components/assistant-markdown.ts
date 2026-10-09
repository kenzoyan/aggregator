/** Recover heading markers attached to a salutation; preserve code and ordinary hashtags. */
export function normalizeAssistantMarkdown(text: string) {
  let fence: string | undefined;
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
      return line;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    const attached = /^([^#\n]{1,40}[,，:：])[ \t]*(#{1,6})[ \t]+(.+)$/.exec(line);
    if (!attached) return line;
    const [, greeting, marker, rest] = attached;
    const chineseBody = /^([^\s]{1,24})[ \t]+((?:是的|不是|当前|目前|截至|根据|这|已)[\s\S]*)$/.exec(rest!);
    return `${greeting}\n\n${marker} ${chineseBody?.[1] ?? rest}${chineseBody ? `\n\n${chineseBody[2]}` : ""}`;
  }).join("\n");
}
