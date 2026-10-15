/* Four-layer boundary, version 1. This is the single authoritative ABI file.
 * Fixed-width integers; byte lengths; no WINDOW/FILE/THING crosses the boundary.
 * Generated Rust and JavaScript constants must derive from this header. */
#ifndef RG_LAYER_ABI_H
#define RG_LAYER_ABI_H
#include <stdint.h>

#define RG_ABI_VERSION 1
#define RG_EVENT_SCALAR_MASK 0x001fffff
#define RG_EVENT_CTRL 0x01000000
#define RG_EVENT_SHIFT 0x02000000
#define RG_EVENT_ALT 0x04000000
#define RG_EVENT_REPEAT 0x08000000
#define RG_KEY_UP 0x00110001
#define RG_KEY_DOWN 0x00110002
#define RG_KEY_LEFT 0x00110003
#define RG_KEY_RIGHT 0x00110004
#define RG_KEY_HOME 0x00110005
#define RG_KEY_END 0x00110006
#define RG_KEY_PAGE_UP 0x00110007
#define RG_KEY_PAGE_DOWN 0x00110008
#define RG_KEY_SAVE 0x00120001
#define RG_KEY_END_INPUT 0x00120002

#define RG_SNAPSHOT_WORDS 20
#define RG_SNAPSHOT_ABI 0
#define RG_SNAPSHOT_SEED 1
#define RG_SNAPSHOT_LEVEL 2
#define RG_SNAPSHOT_X 3
#define RG_SNAPSHOT_Y 4
#define RG_SNAPSHOT_HP 5
#define RG_SNAPSHOT_MAX_HP 6
#define RG_SNAPSHOT_GOLD 7
#define RG_SNAPSHOT_FOOD 8
#define RG_SNAPSHOT_STRENGTH 9
#define RG_SNAPSHOT_ARMOR 10
#define RG_SNAPSHOT_EXPERIENCE 11
#define RG_SNAPSHOT_PLAYER_LEVEL 12
#define RG_SNAPSHOT_TURN 13
#define RG_SNAPSHOT_WORLD_HASH 14
#define RG_SNAPSHOT_ENTITIES_HASH 15
#define RG_SNAPSHOT_KNOWLEDGE_HASH 16
#define RG_SNAPSHOT_EFFECTS_HASH 17
#define RG_SNAPSHOT_FLAGS 18
#define RG_SNAPSHOT_PENDING 19

/* Existing RG_SNAPSHOT_FLAGS bits: original player.t_flags in the low 16
 * bits (ISLEVIT = octal 0000010), original amulet at bit 18. Read-only. */
#define RG_FLAG_LEVITATING 0x00000008
#define RG_FLAG_AMULET 0x00040000

/* Presentation actions only. These do not represent commands or game turns. */
#define RG_ACTOR_MOVE 1
#define RG_ACTOR_ATTACK 2
#define RG_ACTOR_HURT 3

#ifdef __cplusplus
extern "C" {
#endif
/* C logic entry. A fresh module/Worker owns each new game. */
int32_t rg_core_start(uint32_t seed, const char *player_name);
uint32_t rg_core_inspect(uint32_t *out, uint32_t capacity);
int32_t rg_core_save_bytes(uint8_t **out, uint32_t *length);
int32_t rg_core_load_bytes(const uint8_t *bytes, uint32_t length);
void rg_core_save_free(uint8_t *bytes);

/* Rust-owned host callbacks. The C caller lends buffers only for the call. */
int32_t rg_host_read_key(void);
/* Preserve recorded legacy inventory reads while replaying older saves. */
int32_t rg_host_inventory_browser_enabled(void);
/* Presentation policy for ordinary narration only. No input/RNG/turn.
 * Important selections and cancelable pagination keep their C input waits. */
int32_t rg_host_message_requires_acknowledgement(void);
void rg_host_flush_input(void);
void rg_host_present(const uint8_t *cells, uint32_t rows, uint32_t columns);
/* Presentation-only observation of a currently drawn bolt. active=0 clears
 * transient tags. This never changes cells, game state, RNG or save bytes. */
void rg_host_map_effect(int32_t x, int32_t y, int32_t glyph, int32_t active);
/* Per-frame terrain beneath perceived actors. 255 means no observation.
 * Borrows rows*columns bytes; never changes world, RNG, or saved state. */
void rg_host_map_terrain(const uint8_t *glyphs, uint32_t rows, uint32_t columns);
/* Public character observations. Player ID is 0; enemy IDs are opaque and
 * valid only while continuously observed in this epoch. Begin replaces the
 * next frame's actor set. Only already displayed @/A-Z glyphs may be supplied;
 * no THING pointer, hidden type/position/HP, or private movement path crosses
 * this boundary. Reset clears presentation metadata at level/load/start. */
void rg_host_map_actor_reset(uint32_t epoch);
/* Return 0 when Rust keeps a cached map under a game window; then the C
 * observer preserves its previous public identities without reading overlay
 * text as characters. Return 1 when the current public map may be replaced. */
int32_t rg_host_map_actors_begin(void);
void rg_host_map_actor(uint32_t id, int32_t x, int32_t y, int32_t glyph);
/* The C owner reports an actual action/damage at its source. Rust owns the
 * bounded transient queue and sequence; each event is consumed once by the
 * next frame. Events never enter game saves, RNG, or command processing. */
void rg_host_map_actor_event(uint32_t id, uint32_t kind);
void rg_host_message(const char *message_id, const char *arguments_json,
                     const char *legacy_english);
/* UTF-8 semantic UI is presentation data only. row=-1 clears a scope;
 * row=-2 describes an input wait. Buffers are borrowed during the call. */
void rg_host_ui(const char *scope, int32_t row, int32_t column,
                const char *message_id, const char *arguments_json,
                const char *legacy_english);
/* UTF-8 text entry is enabled only by the C text editor, never game commands.
 * enabled=1 edits arbitrary text; enabled=2 edits the real UTF-8 player name;
 * enabled=3 edits the fruit option (its default can be shown as a placeholder);
 * enabled=0 closes the editor. The limit counts UTF-8 bytes. */
void rg_host_text_mode(int32_t enabled, uint32_t limit_bytes, const char *initial);
/* C calls only when its editor actually replaces whoami with a nonempty edit. */
void rg_host_player_name(const char *utf8_name);
void rg_host_outcome(int32_t code, const char *message);
/* Called only at a command's outer boundary, before BEFORE/AFTER processing. */
void rg_host_checkpoint(void);
/* Calendar observation only: the original C tombstone chooses when to use it. */
int32_t rg_host_calendar_year(void);
/* Borrowed restore checkpoint remains valid until rg_core_start returns. */
int32_t rg_host_restore_data(const uint8_t **bytes, uint32_t *length);

/* Native comparison-harness imports used only by Rust. The browser instead
 * uses the fixed-width rogue imports declared in rust/src/host.rs. */
int32_t js_rg_read_event(void);
void js_rg_flush_input(void);
void js_rg_present(const uint8_t *json_utf8, uint32_t length);
void js_rg_store(const uint8_t *envelope_utf8, uint32_t length);
void js_rg_outcome(int32_t code, const uint8_t *text_utf8, uint32_t length);

/* Rust application exports. Configure exactly once before rg_run in a fresh
 * instance. UTF-8 JSON fields: locale (ja/en), trace (boolean), message_paging
 * (classic/log), optional restore (null or the saved JSON as a UTF-8 string).
 * rg_configure borrows the buffer only for the call, copies owned startup data,
 * returns 0 on success, -2 for invalid data and -3 for an already used instance.
 * The caller returns every rg_alloc buffer using its exact pointer/length pair.
 * A completed or failed game must be replaced with a fresh instance/Worker.
 * Diagnostic exports do not advance a turn. CString results have a paired free. */
uint8_t *rg_alloc(uint32_t length);
void rg_dealloc(uint8_t *bytes, uint32_t length);
int32_t rg_configure(const uint8_t *json_utf8, uint32_t length);
int32_t rg_run(uint32_t seed, const char *player_name);
char *rg_snapshot_json(void);
void rg_string_free(char *string);
int32_t rg_validate_envelope(const uint8_t *bytes, uint32_t length);
#ifdef RG_TEST_HOOKS
void rg_test_repaint(void);
int32_t rg_test_save_roundtrip(void);
/* Test configuration alone permits an ASCII fixture ID (1..63 bytes). Copies
 * that ID and its NUL terminator, returns its byte length, 0 if absent or -1
 * when the output buffer is invalid/too small. Absent from production Wasm. */
int32_t rg_host_fixture_id(char *output, uint32_t capacity);
#endif
#ifdef __cplusplus
}
#endif
#endif
