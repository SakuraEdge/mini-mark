#include <stddef.h>
// 0 = success, 1 = invalid or unrepresentable input, 2 = size limit or allocation failure.
int mm_transcode(const char *to, const char *from, const unsigned char *input, size_t length,
                 size_t limit, unsigned char **result, size_t *written);
