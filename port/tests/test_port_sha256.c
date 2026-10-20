/* Rockanrola port test: portable SHA-256 behind the BCrypt shim.
   Uses the FIPS 180-4 / NIST CAVP reference vectors. ROM-free. */
#include "bcrypt.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int check_hex(const char *name, const uint8_t d[32], const char *hex) {
    char got[65];
    int i;
    for (i = 0; i < 32; ++i) (void)snprintf(got + i * 2, 3, "%02x", d[i]);
    if (strcmp(got, hex) != 0) {
        printf("FAIL %s\n  got      %s\n  expected %s\n", name, got, hex);
        return 0;
    }
    printf("ok   %s\n", name);
    return 1;
}

static int via_bcrypt(const void *data, size_t size, uint8_t out[32]) {
    BCRYPT_ALG_HANDLE alg = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    ULONG object_size = 0u, result = 0u;
    uint8_t *object;
    int ok = 0;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, NULL, 0u) < 0) return 0;
    if (BCryptGetProperty(alg, BCRYPT_OBJECT_LENGTH, (PUCHAR)&object_size,
                          sizeof(object_size), &result, 0u) < 0) return 0;
    object = (uint8_t *)malloc(object_size);
    if (object &&
        BCryptCreateHash(alg, &hash, object, object_size, NULL, 0u, 0u) >= 0 &&
        BCryptHashData(hash, (PUCHAR)data, (ULONG)size, 0u) >= 0 &&
        BCryptFinishHash(hash, out, 32u, 0u) >= 0)
        ok = 1;
    if (hash) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(alg, 0u);
    free(object);
    return ok;
}

int main(void) {
    static const char *two_block =
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    uint8_t d[32];
    uint8_t *million;
    int pass = 1;

    rockanrola_sha256("", 0u, d);
    pass &= check_hex("empty", d,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    rockanrola_sha256("abc", 3u, d);
    pass &= check_hex("abc", d,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    rockanrola_sha256(two_block, strlen(two_block), d);
    pass &= check_hex("448-bit", d,
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");

    million = (uint8_t *)malloc(1000000u);
    if (!million) return 2;
    memset(million, 'a', 1000000u);
    rockanrola_sha256(million, 1000000u, d);
    pass &= check_hex("million-a", d,
        "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    pass &= via_bcrypt(million, 1000000u, d);
    pass &= check_hex("million-a via BCrypt shim", d,
        "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    free(million);

    printf(pass ? "PASS test_port_sha256\n" : "FAILED test_port_sha256\n");
    return pass ? 0 : 1;
}
