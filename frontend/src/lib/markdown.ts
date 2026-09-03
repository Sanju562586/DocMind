/**
 * Unescapes HTML entities if present in the raw text stream.
 */
export function unescapeEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * High-performance, robust Markdown preprocessor for DocMind chat messages and UI modals.
 * Fixes text formatting glitches, unescapes entities, normalizes line endings,
 * converts raw unicode bullets (`•`, `▪`, `‣`, `⁃`) into standard Markdown `- `,
 * normalizes dividers (`--`, `---`) to horizontal rules, cleans up citation badges,
 * fixes unbulleted headers, formats key-value lines cleanly, and restores LaTeX math delimiters.
 */
export function preprocessMarkdown(content: string): string {
  if (!content) return "";

  // 1. Unescape HTML entities & normalize line endings to \n
  let processed = unescapeEntities(content).replace(/\r\n/g, "\n");

  // Protect code blocks by stashing them into isolated placeholders
  const codeBlocks: string[] = [];
  processed = processed.replace(/```(\w*)\n([\s\S]*?)```/g, (match) => {
    const placeholder = `___DOCMIND_CODE_BLOCK_${codeBlocks.length}___`;
    codeBlocks.push(match);
    return placeholder;
  });

  // 2. Normalize literal unicode bullet symbols (•, ▪, ‣, ⁃) to standard Markdown bullet `- `
  processed = processed.replace(/^[ \t]*[•▪‣⁃][ \t]*/gm, "- ");

  // 3. Convert standalone `--` or `---` or `***` dividers to clean horizontal rules `---`
  processed = processed.replace(/^[ \t]*(?:--+|[*]{3,}|_{3,})[ \t]*$/gm, "\n---\n");

  // 4. Convert raw document citations `[Unit-2.docx]` into styled inline code badges
  // e.g. `[Unit-2.docx] .` -> `📄 Unit-2.docx.`
  processed = processed.replace(/(?<=\s|^)\[([a-zA-Z0-9_\-\.\s]+\.(?:docx|pdf|txt|csv|xlsx|md))\]/gi, "`📄 $1`");
  // Clean up space before trailing punctuation right after citation badge
  processed = processed.replace(/(`📄 [^`]+`)\s+([.,!?;:])(?=\s|$)/g, "$1$2");

  // 5. Convert `- 1. Heading` or `- 2. Heading` (bullet points containing numbered headings)
  // into clean numbered headings `1. Heading` / `2. Heading`
  processed = processed.replace(/^[ \t]*-\s+(\d+\.\s+[^\n]+)$/gm, "$1");

  // 6. Convert broken split terms like `- *Term*\n- = Explanation` or `*Term*\n= Explanation`
  // into clean structured bullet items `- **Term:** Explanation`
  processed = processed.replace(/^[ \t]*(?:-\s*)?\*+\s*([^*]+?)\s*\*+\s*\n[ \t]*(?:-\s*)?=\s*([^\n]+)/gm, "- **$1:** $2");

  // 7. Section headings without hashes:
  // Convert major section titles like `Simple Distinction`, `Key Features`, `Executive Overview` into H3 headings
  processed = processed.replace(
    /^[ \t]*(?:-\s+)?(Key Features & How It Works|Key Features|Key Benefits|Real-World Examples|Simple Analogy|Executive Overview|Core Concepts|Summary of Findings|Main Takeaways|Simple Distinction)[ \t]*$/gim,
    "\n### $1\n"
  );

  // 8. Convert unbulleted key-value lines (`Term Name: Description`) into clean bullet points:
  // ONLY if line does not already start with list markers (`-`, `*`, `+`, `\d+\.`, `#`, `>`, `|`)
  processed = processed.replace(/^[ \t]*(?![*\-+#>]|\d+\.|\|)([A-Z][a-zA-Z0-9\s\-/]{2,36}):\s+([^\n]+)$/gm, (match, key, val) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.startsWith("http") ||
      lowerKey.startsWith("sources") ||
      lowerKey.startsWith("note") ||
      lowerKey.startsWith("warning")
    ) {
      return match;
    }
    return `- **${key.trim()}:** ${val.trim()}`;
  });

  // 9. Normalize bullet items starting with `* ` or `+ ` to `- `
  processed = processed.replace(/^[ \t]*[*+]\s+/gm, "- ");

  // 10. Fix headings glued to preceding text or missing space after # symbols
  processed = processed.replace(/([^\n])\n*(#{1,6})(?=\s+[^\n]+|[^\s#\n][^\n]*)/g, "$1\n\n$2");
  processed = processed.replace(/^(#{1,6})([^#\s\n][^\n]*)$/gm, "$1 $2");

  // 11. Fix list items glued to paragraph text without a blank line
  processed = processed.replace(/([^\n\s])\n([\-\*]|\d+\.)\s+/g, "$1\n\n$2 ");

  // 12. LaTeX math conversions & syntax cleanup
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n\n$$\n${math.trim()}\n$$\n\n`);
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`);
  processed = processed.replace(/(?<=^|[\s(])\$(?!\$)([^$\n]+?)\$\$(?=[\s.,!?;:)\]]|$)/gm, "$$$1$$");
  processed = processed.replace(/(?<=^|[\s(])\$\$(?!\$)([^$\n]+?)\$(?=[\s.,!?;:)\]]|$)/gm, "$$$1$$");
  processed = processed.replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, math) => `\n$$\n${math.trim()}\n$$\n`);

  // 13. Collapse 3+ consecutive newlines into 2 newlines
  processed = processed.replace(/\n{3,}/g, "\n\n");

  // Restore Code Blocks
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`___DOCMIND_CODE_BLOCK_${i}___`, block);
  });

  return processed.trim();
}
