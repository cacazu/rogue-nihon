/* Four-layer save adapter. The historical Rogue license is in LICENSE.TXT.
 * The bounded container deliberately does not accept historical save files:
 * schema 2 adds passage references, daemon IDs, and separate map knowledge.
 * Only a complete command boundary can be captured here. Rust owns the input
 * journal, browser persistence, and replay to the currently pending input.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../contract/rogue_abi.h"
#include "state_codec.h"
#include "knowledge.h"
#include "core.h"
#include "io_state.h"

#define RG_CONTAINER_HEADER 44u
#define RG_CONTAINER_VERSION 1u
#define RG_KNOWLEDGE_SCHEMA 1u
#define RG_RUNTIME_SCHEMA 1u
#define RG_RUNTIME_HEADER 16u
#define RG_RUNTIME_MAX_WORDS 128u

static const uint8_t rg_save_magic[8] = {'R','G','4','S','A','V','E',0};
static const uint8_t rg_runtime_magic[4] = {'R','G','R','T'};

static uint32_t
rg_read_u32(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
        ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void
rg_write_u32(uint8_t *bytes, uint32_t value)
{
    bytes[0] = (uint8_t)value;
    bytes[1] = (uint8_t)(value >> 8);
    bytes[2] = (uint8_t)(value >> 16);
    bytes[3] = (uint8_t)(value >> 24);
}

/* IEEE CRC32, including all header fields except the CRC field itself.
 * This detects corruption; it is not an authentication or signature scheme. */
static uint32_t
rg_crc_update(uint32_t crc, const uint8_t *bytes, uint32_t length)
{
    uint32_t n;
    int bit;
    for (n = 0; n < length; n++) {
        crc ^= bytes[n];
        for (bit = 0; bit < 8; bit++)
            crc = (crc >> 1) ^ (UINT32_C(0xedb88320) & (0u - (crc & 1u)));
    }
    return crc;
}

static uint32_t
rg_container_crc(const uint8_t *bytes, uint32_t length)
{
    uint32_t crc = rg_crc_update(UINT32_MAX, bytes, 40u);
    crc = rg_crc_update(crc, bytes + RG_CONTAINER_HEADER,
                        length - RG_CONTAINER_HEADER);
    return crc ^ UINT32_MAX;
}

static int
rg_runtime_export(uint8_t **out, uint32_t *length)
{
    uint32_t words[RG_RUNTIME_MAX_WORDS], count, message_length = 0, n, total;
    uint8_t *message = NULL, *bytes;
    count = rg_core_runtime_export(words, RG_RUNTIME_MAX_WORDS);
    if (count == 0 || count > RG_RUNTIME_MAX_WORDS ||
        rg_core_runtime_validate(words, count) != 0 ||
        rg_message_state_export(&message, &message_length) != 0)
        return -1;
    if (message_length > RG_SAVE_MAX_BYTES - RG_RUNTIME_HEADER - count * 4u) {
        free(message);
        return -1;
    }
    total = RG_RUNTIME_HEADER + count * 4u + message_length;
    bytes = malloc(total);
    if (bytes == NULL) {
        free(message);
        return -1;
    }
    memcpy(bytes, rg_runtime_magic, sizeof rg_runtime_magic);
    rg_write_u32(bytes + 4, RG_RUNTIME_SCHEMA);
    rg_write_u32(bytes + 8, count);
    rg_write_u32(bytes + 12, message_length);
    for (n = 0; n < count; n++) rg_write_u32(bytes + RG_RUNTIME_HEADER + n * 4u, words[n]);
    if (message_length != 0)
        memcpy(bytes + RG_RUNTIME_HEADER + count * 4u, message, message_length);
    free(message);
    *out = bytes;
    *length = total;
    return 0;
}

/* Parsed words live on the caller's stack. Both sub-adapters validate without
 * changing globals and import without allocation after successful validation. */
static int
rg_runtime_validate(const uint8_t *bytes, uint32_t length,
                    uint32_t *words, uint32_t *count,
                    const uint8_t **message, uint32_t *message_length)
{
    uint32_t n, prefix;
    if (length < RG_RUNTIME_HEADER ||
        memcmp(bytes, rg_runtime_magic, sizeof rg_runtime_magic) != 0 ||
        rg_read_u32(bytes + 4) != RG_RUNTIME_SCHEMA) return -1;
    *count = rg_read_u32(bytes + 8);
    *message_length = rg_read_u32(bytes + 12);
    if (*count == 0 || *count > RG_RUNTIME_MAX_WORDS) return -1;
    prefix = RG_RUNTIME_HEADER + *count * 4u;
    if (prefix > length || *message_length != length - prefix) return -1;
    for (n = 0; n < *count; n++) words[n] = rg_read_u32(bytes + RG_RUNTIME_HEADER + n * 4u);
    *message = bytes + prefix;
    if (rg_core_runtime_validate(words, *count) != 0 ||
        rg_message_state_validate(*message, *message_length) != 0) return -1;
    return 0;
}

int32_t
rg_core_save_bytes(uint8_t **out, uint32_t *length)
{
    uint8_t *logic = NULL, *knowledge = NULL, *runtime = NULL, *bytes = NULL;
    uint32_t logic_length = 0, knowledge_length = 0, runtime_length = 0, total;
    int32_t result = -1;
    if (out == NULL || length == NULL) return -1;
    *out = NULL;
    *length = 0;
    if (stdscr == NULL || curscr == NULL) return -1;
    if (rg_state_save_bytes(&logic, &logic_length) != 0 ||
        rg_knowledge_export(&knowledge, &knowledge_length) != 0 ||
        rg_runtime_export(&runtime, &runtime_length) != 0) goto done;
    if (logic_length > RG_SAVE_MAX_BYTES - RG_CONTAINER_HEADER ||
        knowledge_length > RG_SAVE_MAX_BYTES - RG_CONTAINER_HEADER - logic_length ||
        runtime_length > RG_SAVE_MAX_BYTES - RG_CONTAINER_HEADER - logic_length - knowledge_length)
        goto done;
    total = RG_CONTAINER_HEADER + logic_length + knowledge_length + runtime_length;
    bytes = malloc(total);
    if (bytes == NULL) goto done;
    memcpy(bytes, rg_save_magic, sizeof rg_save_magic);
    rg_write_u32(bytes + 8, RG_CONTAINER_VERSION);
    rg_write_u32(bytes + 12, RG_STATE_SCHEMA);
    rg_write_u32(bytes + 16, RG_KNOWLEDGE_SCHEMA);
    rg_write_u32(bytes + 20, RG_RUNTIME_SCHEMA);
    rg_write_u32(bytes + 24, logic_length);
    rg_write_u32(bytes + 28, knowledge_length);
    rg_write_u32(bytes + 32, runtime_length);
    rg_write_u32(bytes + 36, rg_core_turn());
    memcpy(bytes + RG_CONTAINER_HEADER, logic, logic_length);
    memcpy(bytes + RG_CONTAINER_HEADER + logic_length, knowledge, knowledge_length);
    memcpy(bytes + RG_CONTAINER_HEADER + logic_length + knowledge_length, runtime, runtime_length);
    rg_write_u32(bytes + 40, rg_container_crc(bytes, total));
    *out = bytes;
    *length = total;
    result = 0;
done:
    free(logic);
    free(knowledge);
    free(runtime);
    return result;
}

int32_t
rg_core_load_bytes(const uint8_t *bytes, uint32_t length)
{
    uint32_t logic_length, knowledge_length, runtime_length, words[RG_RUNTIME_MAX_WORDS];
    uint32_t count, message_length;
    const uint8_t *logic, *knowledge, *runtime, *message;
    if (stdscr == NULL || curscr == NULL || bytes == NULL ||
        length < RG_CONTAINER_HEADER || length > RG_SAVE_MAX_BYTES ||
        memcmp(bytes, rg_save_magic, sizeof rg_save_magic) != 0 ||
        rg_read_u32(bytes + 8) != RG_CONTAINER_VERSION ||
        rg_read_u32(bytes + 12) != RG_STATE_SCHEMA ||
        rg_read_u32(bytes + 16) != RG_KNOWLEDGE_SCHEMA ||
        rg_read_u32(bytes + 20) != RG_RUNTIME_SCHEMA) return -1;
    logic_length = rg_read_u32(bytes + 24);
    knowledge_length = rg_read_u32(bytes + 28);
    runtime_length = rg_read_u32(bytes + 32);
    if (logic_length == 0 || logic_length > length - RG_CONTAINER_HEADER ||
        knowledge_length > length - RG_CONTAINER_HEADER - logic_length ||
        runtime_length != length - RG_CONTAINER_HEADER - logic_length - knowledge_length ||
        rg_read_u32(bytes + 40) != rg_container_crc(bytes, length)) return -1;
    logic = bytes + RG_CONTAINER_HEADER;
    knowledge = logic + logic_length;
    runtime = knowledge + knowledge_length;
    if (rg_knowledge_validate(knowledge, knowledge_length) != 0 ||
        rg_runtime_validate(runtime, runtime_length, words, &count, &message, &message_length) != 0 ||
        words[0] != rg_read_u32(bytes + 36)) return -1;
    /* The sole allocating/destructive operation is transactional. Later
     * imports only copy the fully validated buffers and cannot allocate. */
    if (rg_state_load_bytes(logic, logic_length) != 0) return -1;
    if (rg_core_runtime_import(words, count) != 0 ||
        rg_knowledge_import(knowledge, knowledge_length) != 0 ||
        rg_message_state_import(message, message_length) != 0) return -1;
    return 0;
}

void
rg_core_save_free(uint8_t *bytes)
{
    free(bytes);
}
