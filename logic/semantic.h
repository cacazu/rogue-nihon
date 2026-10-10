/* Pure presentation metadata; never part of game rules or saved logic state. */
#ifndef RG_SEMANTIC_H
#define RG_SEMANTIC_H
#include <stddef.h>
#include <stdint.h>

/* Observe terrain beneath actors already present in the copied screen. */
void rg_semantic_map_terrain(const uint8_t *cells,uint32_t rows,uint32_t columns);

/* Return 1 for a descriptor, 0 for an ordinary literal, -1 for insufficient
 * space. The result is a JSON value object, not an English reverse translation.
 * Registered pointers are accepted only while the English bytes still match. */
int rg_semantic_argument(const char *text, char *json, size_t capacity);
/* A source-chosen static term ID is localized by the root UI catalog. */
void rg_semantic_register_term(const char *text, const char *id);
/* args_json is a trusted generated typed array, parsed/validated by Rust. */
void rg_semantic_register_message(const char *text, const char *id,
                                  const char *args_json);

union thing;
void rg_semantic_item(const char *text, const union thing *object, int drop);
void rg_semantic_monster(const char *text, int index, const char *display,
                         int article, int upper, int hallucinated);
void rg_semantic_combatant(const char *text, const char *source, int upper);
void rg_semantic_combat_verb(const char *text, int hit, int index);
void rg_semantic_death(const char *text, int code, int article);
void rg_semantic_category(const char *text, int category);
void rg_semantic_copy(const char *text, const char *source);
#endif
