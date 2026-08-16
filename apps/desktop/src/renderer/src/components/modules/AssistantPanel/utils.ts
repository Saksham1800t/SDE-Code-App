export const extractCodeBlock = (text: string): string => {
  const codeBlockRegex = /```[\w]*\n([\s\S]*?)\n```/g;
  const match = codeBlockRegex.exec(text);
  if (match && match[1]) {
    return match[1];
  }
  const startIdx = text.indexOf('```');
  if (startIdx !== -1) {
    const languageEndIdx = text.indexOf('\n', startIdx);
    const endIdx = text.indexOf('```', languageEndIdx !== -1 ? languageEndIdx : startIdx + 3);
    if (endIdx !== -1 && languageEndIdx !== -1) {
      return text.substring(languageEndIdx + 1, endIdx);
    }
  }
  return text;
};
