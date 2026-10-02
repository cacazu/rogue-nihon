(function (scope) {
  "use strict";
  class UiCatalog {
    static validText(value, limit, allowEmpty = true) {
      return typeof value === "string" && (allowEmpty || value.length > 0) && Number.isInteger(limit) && limit >= 0
        && !/[\u0000-\u001f\u007f]/u.test(value) && new TextEncoder().encode(value).length <= limit;
    }
    constructor(catalogs, locale = "ja") {
      this.catalogs = catalogs; this.locale = locale; this.missing = [];
    }
    text(id, args = {}) {
      const template = this.catalogs[this.locale]?.messages?.[id];
      if (typeof template !== "string") { this.missing.push({ locale: this.locale, id }); throw new Error("Missing UI catalog entry: " + id); }
      return template.replace(/\{([a-zA-Z_][a-zA-Z_0-9]*)\}/g, (_, name) => {
        if (!Object.hasOwn(args, name)) throw new Error("Missing UI argument: " + id + "." + name);
        return String(args[name]);
      });
    }
    apply(root) {
      root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = this.text(element.dataset.i18n); });
      root.querySelectorAll("[data-i18n-aria]").forEach((element) => { element.setAttribute("aria-label", this.text(element.dataset.i18nAria)); });
    }
  }
  scope.RogueUiCatalog = UiCatalog;
  if (typeof module !== "undefined" && module.exports) module.exports = UiCatalog;
})(globalThis);
