/*
 * Rockanrola - snprintf with a fast path for the exact format "%s".
 *
 * Profiling the WebAssembly core with the real game showed ~35% of all CPU
 * time inside musl's printf machinery: the upstream audio sync path clears
 * its error buffer with snprintf(buf, cap, "%s", "") thousands of times per
 * video frame. This definition takes precedence over libc's snprintf at link
 * time (static linking), keeps identical C99 semantics (truncation, NUL
 * termination, return value = full length) and forwards every other format
 * to vsnprintf unchanged. Upstream sources stay unmodified.
 *
 * Copyright (c) 2026 Rockanrola contributors. zlib license.
 */
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

int snprintf(char *restrict out, size_t capacity, const char *restrict format, ...) {
    va_list args;
    int result;
    if (format[0] == '%' && format[1] == 's' && format[2] == '\0') {
        const char *text;
        size_t length;
        va_start(args, format);
        text = va_arg(args, const char *);
        va_end(args);
        if (!text) text = "(null)"; /* musl prints "(null)" too */
        length = strlen(text);
        if (capacity) {
            size_t copy = length < capacity - 1u ? length : capacity - 1u;
            memcpy(out, text, copy);
            out[copy] = '\0';
        }
        return (int)length;
    }
    va_start(args, format);
    result = vsnprintf(out, capacity, format, args);
    va_end(args);
    return result;
}
