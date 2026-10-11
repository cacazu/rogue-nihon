/* Native file selection only. Rust owns the restore decision. */
globalThis.RogueSaveImport = {
  choose() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.hidden = true;
      const finish = value => { input.remove(); resolve(value); };
      input.addEventListener("cancel", () => finish(null), {once:true});
      input.addEventListener("change", async () => {
        try {
          const file = input.files[0];
          if (!file) return finish(null);
          if (file.size > 16 * 1024 * 1024) throw new Error("Save file is too large");
          const bytes = new Uint8Array(await file.arrayBuffer());
          // The game validates the opaque save and its checksum when restoring.
          input.remove(); resolve(bytes);
        } catch (error) { input.remove(); reject(error); }
      }, {once:true});
      document.body.append(input);
      input.click();
    });
  }
};
