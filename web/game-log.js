(function (scope) {
  "use strict";
  class GameLog {
    constructor(limit = 500) { this.limit = limit; this.entries = []; }
    append(entry) { this.entries.push(entry); if (this.entries.length > this.limit) this.entries.shift(); }
    message(message) {
      if (!message || message.id === "message.clear" || !message.text) return;
      const source = message.id?.startsWith("platform.") ? "system" : "game";
      this.append({ source, message, error: source === "system" });
    }
    notice(id, args, error) {
      this.append({ source: "system", id, args, error });
    }
    static atBottom(element) { return element.scrollHeight - element.clientHeight - element.scrollTop <= 4; }
  }
  scope.RogueGameLog = GameLog;
  if (typeof module !== "undefined" && module.exports) module.exports = GameLog;
})(globalThis);
