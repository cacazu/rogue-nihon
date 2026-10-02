#ifndef RG_MESSAGE_H
#define RG_MESSAGE_H
#include <stdarg.h>
#include <stddef.h>

#define RG_MESSAGE_ARGUMENT_BYTES 8192
#define RG_MESSAGE_FALLBACK_BYTES 1024

struct rg_message_part {
    const char *id;
    char arguments[RG_MESSAGE_ARGUMENT_BYTES];
    char fallback[RG_MESSAGE_FALLBACK_BYTES];
};

int rg_msg(const char *file, int line, const char *format, ...);
void rg_addmsg(const char *file, int line, const char *format, ...);
int rg_message_arguments(const char *format, va_list arguments,
                         char *json, size_t capacity);
int rg_capture_arguments(char *json, size_t capacity, const char *format, ...);
void rg_message_prepare(struct rg_message_part *part, const char *file,
                        int line, const char *format, va_list arguments);
void rg_message_push(const struct rg_message_part *part);
void rg_message_flush(const char *combined_english);
void rg_message_clear(void);
void rg_message_discard(void);
void rg_ui_line(const char *scope, int row, int column, const char *id,
                const char *arguments_json, const char *fallback);
void rg_ui_clear(const char *scope);
void rg_ui_printf(const char *scope, int row, int column, const char *file,
                  int line, const char *format, ...);
#endif
