#ifndef RG_IO_STATE_H
#define RG_IO_STATE_H
#include <stdint.h>
/* malloc-owned export; caller releases with free. All return 0 or -1. */
int rg_message_state_export(uint8_t **out, uint32_t *length);
int rg_message_state_validate(const uint8_t *bytes, uint32_t length);
int rg_message_state_import(const uint8_t *bytes, uint32_t length);
#endif
