#ifndef ROGUE_STATE_CODEC_H
#define ROGUE_STATE_CODEC_H

#include <stdint.h>

/* Schema 2 is the bounded, little-endian logic payload, without a WINDOW.
 * These internal operations are called only at a complete command boundary.
 * Returned buffers belong to the caller. A failed load leaves globals intact.
 */
#define RG_STATE_SCHEMA 2u
#define RG_SAVE_MAX_BYTES (4u * 1024u * 1024u)
int rg_state_save_bytes(uint8_t **out, uint32_t *length);
int rg_state_load_bytes(const uint8_t *bytes, uint32_t length);

#endif
