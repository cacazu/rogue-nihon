/* Message metadata does not advance the game or alter its random generator. */
#include <ctype.h>
#include <inttypes.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "message.h"
#include "semantic.h"
#include "../contract/rogue_abi.h"

struct rg_message_site {
    const char *file;
    int line;
    const char *format;
    const char *id;
    int argument_count;
};
#include "message_catalog.inc"

struct json_writer {
    char *bytes;
    size_t capacity;
    size_t used;
    int valid;
};

static void json_init(struct json_writer *out, char *bytes, size_t capacity)
{
    out->bytes = bytes;
    out->capacity = capacity;
    out->used = 0;
    out->valid = capacity != 0;
    if (capacity != 0) bytes[0] = '\0';
}

static void json_text(struct json_writer *out, const char *text)
{
    size_t length;
    if (!out->valid) return;
    length = strlen(text);
    if (length >= out->capacity - out->used) {
        out->valid = 0;
        return;
    }
    memcpy(out->bytes + out->used, text, length + 1);
    out->used += length;
}

static void json_string(struct json_writer *out, const char *text)
{
    const unsigned char *cursor = (const unsigned char *)(text ? text : "");
    char escaped[7];
    json_text(out, "\"");
    for (; *cursor && out->valid; ++cursor) {
        if (*cursor == '"') json_text(out, "\\\"");
        else if (*cursor == '\\') json_text(out, "\\\\");
        else if (*cursor < 0x20) {
            snprintf(escaped, sizeof escaped, "\\u%04x", (unsigned)*cursor);
            json_text(out, escaped);
        } else {
            char byte[2] = {(char)*cursor, '\0'};
            json_text(out, byte); /* Preserve unsigned UTF-8 bytes. */
        }
    }
    json_text(out, "\"");
}

static void json_argument(struct json_writer *out, int *count,
                          const char *kind, const char *value, int quote)
{
    if ((*count)++) json_text(out, ",");
    json_text(out, "{\"kind\":");
    json_string(out, kind);
    json_text(out, ",\"value\":");
    if (quote) json_string(out, value);
    else json_text(out, value);
    json_text(out, "}");
}

/* Consume exactly printf's promoted scalar arguments, including star widths.
 * %n is deliberately unsupported: metadata capture must never write to memory. */
int rg_message_arguments(const char *format, va_list arguments,
                         char *json, size_t capacity)
{
    struct json_writer out;
    const char *cursor = format;
    char value[128];
    int count = 0;
    json_init(&out, json, capacity);
    json_text(&out, "[");
    while (*cursor && out.valid) {
        char length[3] = {0, 0, 0}, conversion;
        if (*cursor++ != '%') continue;
        if (*cursor == '%') { cursor++; continue; }
        while (*cursor && strchr("-+ #0", *cursor)) cursor++;
        if (*cursor == '*') {
            snprintf(value, sizeof value, "%d", va_arg(arguments, int));
            json_argument(&out, &count, "signed", value, 0);
            cursor++;
        } else while (isdigit((unsigned char)*cursor)) cursor++;
        if (*cursor == '.') {
            cursor++;
            if (*cursor == '*') {
                snprintf(value, sizeof value, "%d", va_arg(arguments, int));
                json_argument(&out, &count, "signed", value, 0);
                cursor++;
            } else while (isdigit((unsigned char)*cursor)) cursor++;
        }
        if (*cursor && strchr("hljztL", *cursor)) {
            length[0] = *cursor++;
            if ((length[0] == 'h' || length[0] == 'l') && *cursor == length[0])
                length[1] = *cursor++;
        }
        conversion = *cursor;
        if (!conversion) { out.valid = 0; break; }
        cursor++;
        if (conversion == 'd' || conversion == 'i') {
            intmax_t number;
            if (length[0] == 'L') { out.valid = 0; break; }
            if (!strcmp(length, "ll")) number = va_arg(arguments, long long);
            else if (!strcmp(length, "l")) number = va_arg(arguments, long);
            else if (!strcmp(length, "j")) number = va_arg(arguments, intmax_t);
            else if (!strcmp(length, "z") || !strcmp(length, "t")) number = va_arg(arguments, ptrdiff_t);
            else number = va_arg(arguments, int);
            if (!strcmp(length, "hh")) number = (signed char)number;
            else if (!strcmp(length, "h")) number = (short)number;
            snprintf(value, sizeof value, "%" PRIdMAX, number);
            json_argument(&out, &count, "signed", value, 0);
        } else if (strchr("uoxX", conversion)) {
            uintmax_t number;
            if (length[0] == 'L') { out.valid = 0; break; }
            if (!strcmp(length, "ll")) number = va_arg(arguments, unsigned long long);
            else if (!strcmp(length, "l")) number = va_arg(arguments, unsigned long);
            else if (!strcmp(length, "j")) number = va_arg(arguments, uintmax_t);
            else if (!strcmp(length, "z") || !strcmp(length, "t")) number = va_arg(arguments, size_t);
            else number = va_arg(arguments, unsigned int);
            if (!strcmp(length, "hh")) number = (unsigned char)number;
            else if (!strcmp(length, "h")) number = (unsigned short)number;
            snprintf(value, sizeof value, "%" PRIuMAX, number);
            json_argument(&out, &count, "unsigned", value, 0);
        } else if (conversion == 'c' && !length[0]) {
            snprintf(value, sizeof value, "%d", va_arg(arguments, int));
            json_argument(&out, &count, "signed", value, 0);
        } else if (conversion == 's' && !length[0]) {
            const char *text = va_arg(arguments, const char *);
            char descriptor[RG_MESSAGE_ARGUMENT_BYTES];
            if (text && rg_semantic_argument(text, descriptor, sizeof descriptor) == 1)
                json_argument(&out, &count, "entity", descriptor, 0);
            else
                json_argument(&out, &count, "string", text ? text : "(null)", 1);
        } else if (strchr("fFeEgGaA", conversion)) {
            double number;
            if (length[1] || (length[0] && length[0] != 'L' && length[0] != 'l')) {
                out.valid = 0;
                break;
            }
            number = length[0] == 'L' ? (double)va_arg(arguments, long double) : va_arg(arguments, double);
            if (isfinite(number)) snprintf(value, sizeof value, "%.17g", number);
            else strcpy(value, "null");
            json_argument(&out, &count, "float", value, 0);
        } else if (conversion == 'p' && !length[0]) {
            snprintf(value, sizeof value, "%p", va_arg(arguments, void *));
            json_argument(&out, &count, "string", value, 1);
        } else {
            out.valid = 0;
        }
    }
    json_text(&out, "]");
    if (!out.valid) {
        if (capacity >= 3) strcpy(json, "[]");
        return -1;
    }
    return 0;
}

static const char *basename_of(const char *file)
{
    const char *start = file, *cursor;
    for (cursor = file; *cursor; ++cursor)
        if (*cursor == '/' || *cursor == '\\') start = cursor + 1;
    return start;
}

int rg_capture_arguments(char *json, size_t capacity, const char *format, ...)
{
    int result;
    va_list arguments;
    va_start(arguments, format);
    result = rg_message_arguments(format, arguments, json, capacity);
    va_end(arguments);
    return result;
}

/* Inventory's selection key is a value, not part of a translated sentence. */
static int rg_inventory_arguments(const char *format, va_list arguments,
                                   char *json, size_t capacity)
{
    struct json_writer out;
    char item[RG_MESSAGE_ARGUMENT_BYTES], number[24];
    int count = 0;
    if (!format || !isalpha((unsigned char)format[0]) || strcmp(format + 1, ") %s"))
        return 0;
    if (rg_message_arguments("%s", arguments, item, sizeof item) != 0) return -1;
    json_init(&out, json, capacity);
    json_text(&out, "[");
    snprintf(number, sizeof number, "%u", (unsigned char)format[0]);
    json_argument(&out, &count, "signed", number, 0);
    json_text(&out, ",");
    /* item is a validated typed array of exactly one string/entity argument. */
    item[strlen(item) - 1] = 0;
    json_text(&out, item + 1);
    json_text(&out, "]");
    return out.valid ? 1 : -1;
}

void rg_message_prepare(struct rg_message_part *part, const char *file,
                        int line, const char *format, va_list arguments)
{
    const char *base = basename_of(file);
    size_t index;
    int supplied_arguments = 0, known_template = 0, valid_arguments;
    va_list capture, render;
    part->id = "message.legacy";
    strcpy(part->arguments, "[]");
    if (!format) format = "";
    for (index = 0; index < sizeof rg_message_sites / sizeof rg_message_sites[0]; ++index) {
        const struct rg_message_site *site = &rg_message_sites[index];
        if (site->line != line || strcmp(site->file, base)) continue;
        supplied_arguments = site->argument_count;
        if (site->format && !strcmp(site->format, format)) {
            known_template = 1;
            part->id = site->id;
            break;
        }
    }
    /* Dynamic names and source-chosen terms carry their descriptor even when
     * a menu happens to supply an unused NULL argument. */
    if (!known_template) {
        char descriptor[RG_MESSAGE_ARGUMENT_BYTES];
        if (rg_semantic_argument(format, descriptor, sizeof descriptor) == 1) {
            struct json_writer out;
            int count = 0;
            json_init(&out, part->arguments, sizeof part->arguments);
            json_text(&out, "[");
            json_argument(&out, &count, "entity", descriptor, 0);
            json_text(&out, "]");
            if (out.valid) part->id = "message.entity";
            snprintf(part->fallback, sizeof part->fallback, "%s", format);
            return;
        }
        if (supplied_arguments > 0) {
            va_copy(capture, arguments);
            valid_arguments = rg_inventory_arguments(format, capture, part->arguments, sizeof part->arguments);
            va_end(capture);
            if (valid_arguments == 1) {
                part->id = "ui.inventory.entry";
                va_copy(render, arguments);
                vsnprintf(part->fallback, sizeof part->fallback, format, render);
                va_end(render);
                return;
            }
            if (!strcmp(format, "%s")) {part->id = "ui.text";known_template = 1;}
            else for (index = 0; index < sizeof rg_message_sites / sizeof rg_message_sites[0]; ++index)
                if (rg_message_sites[index].format && !strcmp(format, rg_message_sites[index].format)) {
                    part->id = rg_message_sites[index].id;known_template = 1;break;
                }
        }
        /* Zero-vararg user text may contain %, so never treat it as printf. */
        if (!known_template && supplied_arguments == 0) {
            snprintf(part->fallback, sizeof part->fallback, "%s", format);
            return;
        }
    }
    va_copy(capture, arguments);
    valid_arguments = rg_message_arguments(format, capture, part->arguments, sizeof part->arguments);
    va_end(capture);
    if (valid_arguments != 0) {
        part->id = "message.legacy";
        snprintf(part->fallback, sizeof part->fallback, "%s", format);
        return;
    }
    va_copy(render, arguments);
    if (vsnprintf(part->fallback, sizeof part->fallback, format, render) < 0)
        snprintf(part->fallback, sizeof part->fallback, "%s", format);
    va_end(render);
}

void rg_ui_line(const char *scope, int row, int column, const char *id,
                const char *arguments_json, const char *fallback)
{
    rg_host_ui(scope, row, column, id, arguments_json, fallback);
}

void rg_ui_clear(const char *scope)
{
    rg_host_ui(scope, -1, 0, "message.clear", "[]", "");
}

void rg_ui_printf(const char *scope, int row, int column, const char *file,
                  int line, const char *format, ...)
{
    struct rg_message_part part;
    va_list capture, render, original;
    size_t index;
    char descriptor[RG_MESSAGE_ARGUMENT_BYTES];
    (void)file; (void)line;
    if (!format) return;
    if (rg_semantic_argument(format, descriptor, sizeof descriptor) == 1) {
        struct json_writer out;
        int count = 0;
        json_init(&out, part.arguments, sizeof part.arguments);
        json_text(&out, "[");json_argument(&out, &count, "entity", descriptor, 0);json_text(&out, "]");
        rg_ui_line(scope, row, column, "message.entity", out.valid ? part.arguments : "[]", format);
        return;
    }
    part.id = "ui.untranslated";
    if (!strcmp(format, "%s")) part.id = "ui.text";
    else if (!strcmp(format, "%c) %s")) part.id = "ui.inventory.entry";
    else {
        /* Match a declared original template, never a formatted English sentence. */
        for (index = 0; index < sizeof rg_message_sites / sizeof rg_message_sites[0]; ++index)
            if (rg_message_sites[index].format && !strcmp(format, rg_message_sites[index].format)) {
                part.id = rg_message_sites[index].id;
                break;
            }
    }
    va_start(original, format);
    va_copy(capture, original);
    {
      int inventory = rg_inventory_arguments(format, capture, part.arguments, sizeof part.arguments);
      va_end(capture);
      if (inventory == 1) part.id = "ui.inventory.entry";
      else {
        va_copy(capture, original);
        if (rg_message_arguments(format, capture, part.arguments, sizeof part.arguments) != 0) {
        strcpy(part.arguments, "[]");
        part.id = "ui.untranslated";
        }
        va_end(capture);
      }
    }
    va_copy(render, original);
    if (vsnprintf(part.fallback, sizeof part.fallback, format, render) < 0)
        part.fallback[0] = 0;
    va_end(render);
    va_end(original);
    rg_ui_line(scope, row, column, part.id, part.arguments, part.fallback);
}

#define RG_MESSAGE_PARTS 32
static struct rg_message_part pending[RG_MESSAGE_PARTS];
static size_t pending_count;
static int pending_overflow;
static char sequence_json[RG_MESSAGE_PARTS * (RG_MESSAGE_ARGUMENT_BYTES + RG_MESSAGE_FALLBACK_BYTES * 6 + 512)];

void rg_message_discard(void)
{
    pending_count = 0;
    pending_overflow = 0;
}

void rg_message_push(const struct rg_message_part *part)
{
    if (pending_count < RG_MESSAGE_PARTS) pending[pending_count++] = *part;
    else pending_overflow = 1;
}

void rg_message_clear(void)
{
    /* Clear the displayed message; a pending addmsg chain remains C-owned. */
    rg_host_message("message.clear", "[]", "");
}

void rg_message_flush(const char *combined_english)
{
    struct json_writer out;
    size_t index;
    if (pending_overflow || pending_count == 0) {
        rg_host_message("message.legacy", "[]", combined_english);
    } else if (pending_count == 1) {
        rg_semantic_register_message(combined_english, pending[0].id, pending[0].arguments);
        rg_host_message(pending[0].id, pending[0].arguments, combined_english);
    } else {
        json_init(&out, sequence_json, sizeof sequence_json);
        json_text(&out, "[");
        for (index = 0; index < pending_count; ++index) {
            if (index) json_text(&out, ",");
            json_text(&out, "{\"kind\":\"message_part\",\"value\":{\"id\":");
            json_string(&out, pending[index].id);
            json_text(&out, ",\"args\":");
            json_text(&out, pending[index].arguments);
            json_text(&out, ",\"fallback\":");
            json_string(&out, pending[index].fallback);
            json_text(&out, "}}");
        }
        json_text(&out, "]");
        if (out.valid) rg_semantic_register_message(combined_english, "message.sequence", sequence_json);
        rg_host_message(out.valid ? "message.sequence" : "message.legacy",
                        out.valid ? sequence_json : "[]", combined_english);
    }
    rg_message_discard();
}
