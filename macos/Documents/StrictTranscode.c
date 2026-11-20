#include "StrictTranscode.h"
#include <iconv.h>
#include <errno.h>
#include <stdlib.h>

int mm_transcode(const char *to, const char *from, const unsigned char *input, size_t length,
                 size_t limit, unsigned char **result, size_t *written) {
    *result = NULL;
    *written = 0;
    iconv_t codec = iconv_open(to, from);
    if (codec == (iconv_t)-1) return 1;
    size_t capacity = length < 128 ? 128 : length;
    if (capacity > limit) capacity = limit;
    char *bytes = malloc(capacity);
    size_t left = length, used = 0;
    char *source = (char *)input;
    int status = 2;
    while (bytes) {
        char *out = bytes + used;
        size_t available = capacity - used;
        size_t count = iconv(codec, &source, &left, &out, &available);
        used = capacity - available;
        if (count != (size_t)-1) { status = count == 0 && left == 0 ? 0 : 1; break; }
        if (errno != E2BIG) { status = 1; break; }
        if (capacity == limit) break;
        capacity = capacity > limit / 2 ? limit : capacity * 2;
        char *larger = realloc(bytes, capacity);
        if (!larger) break;
        bytes = larger;
    }
    iconv_close(codec);
    if (status) free(bytes);
    else { *result = (unsigned char *)bytes; *written = used; }
    return status;
}
