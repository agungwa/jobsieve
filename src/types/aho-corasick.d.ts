declare module "aho-corasick" {
  /**
   * Minimal typing for the aho-corasick package (no @types published).
   * Usage: new AhoCorasick() → add(term, data) per keyword → build_fail()
   * → search(text, callback) where callback gets (term, data, startIndex).
   */
  class AhoCorasick {
    constructor();
    add(word: string, data?: unknown): AhoCorasick;
    build_fail(node?: unknown): AhoCorasick;
    search(text: string, callback: (term: string, data: unknown, startIndex: number) => void): AhoCorasick;
  }
  export = AhoCorasick;
}
