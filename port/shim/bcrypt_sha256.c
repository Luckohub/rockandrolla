/*
 * Rockanrola web port - portable SHA-256 (FIPS 180-4) exposed through the
 * BCrypt subset declared in bcrypt.h. Written for this project and released
 * under the zlib license, like the rest of the Rockanrola port code.
 */
#include "bcrypt.h"

#include <string.h>

#define STATUS_SUCCESS ((NTSTATUS)0)
#define STATUS_INVALID_PARAMETER ((NTSTATUS)0xC000000Du)
#define STATUS_NOT_SUPPORTED ((NTSTATUS)0xC00000BBu)

typedef struct RockanrolaSha256 {
    uint32_t state[8];
    uint64_t length;
    uint8_t block[64];
    size_t used;
} RockanrolaSha256;

static const uint32_t k_round[64] = {
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,
    0x923f82a4u,0xab1c5ed5u,0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,
    0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,0xe49b69c1u,0xefbe4786u,
    0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,
    0x06ca6351u,0x14292967u,0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,
    0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,0xa2bfe8a1u,0xa81a664bu,
    0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,
    0x5b9cca4fu,0x682e6ff3u,0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,
    0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
};

static uint32_t rotr(uint32_t x, unsigned n) {
    return (x >> n) | (x << (32u - n));
}

static void compress(RockanrolaSha256 *c, const uint8_t *p) {
    uint32_t w[64], a, b, cc, d, e, f, g, h, t1, t2;
    unsigned i;
    for (i = 0u; i < 16u; ++i)
        w[i] = ((uint32_t)p[i * 4u] << 24) | ((uint32_t)p[i * 4u + 1u] << 16) |
               ((uint32_t)p[i * 4u + 2u] << 8) | (uint32_t)p[i * 4u + 3u];
    for (i = 16u; i < 64u; ++i) {
        uint32_t s0 = rotr(w[i - 15u], 7u) ^ rotr(w[i - 15u], 18u) ^ (w[i - 15u] >> 3);
        uint32_t s1 = rotr(w[i - 2u], 17u) ^ rotr(w[i - 2u], 19u) ^ (w[i - 2u] >> 10);
        w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
    }
    a = c->state[0]; b = c->state[1]; cc = c->state[2]; d = c->state[3];
    e = c->state[4]; f = c->state[5]; g = c->state[6]; h = c->state[7];
    for (i = 0u; i < 64u; ++i) {
        t1 = h + (rotr(e, 6u) ^ rotr(e, 11u) ^ rotr(e, 25u)) +
             ((e & f) ^ (~e & g)) + k_round[i] + w[i];
        t2 = (rotr(a, 2u) ^ rotr(a, 13u) ^ rotr(a, 22u)) +
             ((a & b) ^ (a & cc) ^ (b & cc));
        h = g; g = f; f = e; e = d + t1; d = cc; cc = b; b = a; a = t1 + t2;
    }
    c->state[0] += a; c->state[1] += b; c->state[2] += cc; c->state[3] += d;
    c->state[4] += e; c->state[5] += f; c->state[6] += g; c->state[7] += h;
}

static void sha_init(RockanrolaSha256 *c) {
    static const uint32_t iv[8] = {
        0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,
        0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u };
    memcpy(c->state, iv, sizeof(iv));
    c->length = 0u;
    c->used = 0u;
}

static void sha_update(RockanrolaSha256 *c, const uint8_t *p, size_t n) {
    c->length += (uint64_t)n;
    while (n) {
        size_t take = 64u - c->used;
        if (take > n) take = n;
        memcpy(c->block + c->used, p, take);
        c->used += take; p += take; n -= take;
        if (c->used == 64u) { compress(c, c->block); c->used = 0u; }
    }
}

static void sha_final(RockanrolaSha256 *c, uint8_t out[32]) {
    uint64_t bits = c->length * 8u;
    unsigned i;
    c->block[c->used++] = 0x80u;
    if (c->used > 56u) {
        memset(c->block + c->used, 0, 64u - c->used);
        compress(c, c->block);
        c->used = 0u;
    }
    memset(c->block + c->used, 0, 56u - c->used);
    for (i = 0u; i < 8u; ++i)
        c->block[56u + i] = (uint8_t)(bits >> (56u - 8u * i));
    compress(c, c->block);
    for (i = 0u; i < 32u; ++i)
        out[i] = (uint8_t)(c->state[i / 4u] >> (24u - 8u * (i % 4u)));
}

void rockanrola_sha256(const void *data, size_t size, uint8_t digest[32]) {
    RockanrolaSha256 c;
    sha_init(&c);
    sha_update(&c, (const uint8_t *)data, size);
    sha_final(&c, digest);
}

static int wide_equal(LPCWSTR a, const wchar_t *b) {
    return a && wcscmp(a, b) == 0;
}

static int g_algorithm_token;

NTSTATUS BCryptOpenAlgorithmProvider(BCRYPT_ALG_HANDLE *algorithm,
                                     LPCWSTR algorithm_id,
                                     LPCWSTR implementation, ULONG flags) {
    (void)implementation; (void)flags;
    if (!algorithm) return STATUS_INVALID_PARAMETER;
    *algorithm = NULL;
    if (!wide_equal(algorithm_id, BCRYPT_SHA256_ALGORITHM))
        return STATUS_NOT_SUPPORTED;
    *algorithm = &g_algorithm_token;
    return STATUS_SUCCESS;
}

NTSTATUS BCryptGetProperty(BCRYPT_HANDLE object, LPCWSTR property,
                           PUCHAR output, ULONG output_size,
                           ULONG *result_size, ULONG flags) {
    ULONG length = (ULONG)sizeof(RockanrolaSha256);
    (void)flags;
    if (object != &g_algorithm_token ||
        !wide_equal(property, BCRYPT_OBJECT_LENGTH))
        return STATUS_NOT_SUPPORTED;
    if (!output || output_size < sizeof(ULONG)) return STATUS_INVALID_PARAMETER;
    memcpy(output, &length, sizeof(length));
    if (result_size) *result_size = (ULONG)sizeof(ULONG);
    return STATUS_SUCCESS;
}

NTSTATUS BCryptCreateHash(BCRYPT_ALG_HANDLE algorithm,
                          BCRYPT_HASH_HANDLE *hash, PUCHAR hash_object,
                          ULONG hash_object_size, PUCHAR secret,
                          ULONG secret_size, ULONG flags) {
    (void)secret; (void)flags;
    if (algorithm != &g_algorithm_token || !hash || !hash_object ||
        hash_object_size < sizeof(RockanrolaSha256) || secret_size)
        return STATUS_INVALID_PARAMETER;
    sha_init((RockanrolaSha256 *)(void *)hash_object);
    *hash = hash_object;
    return STATUS_SUCCESS;
}

NTSTATUS BCryptHashData(BCRYPT_HASH_HANDLE hash, PUCHAR input,
                        ULONG input_size, ULONG flags) {
    (void)flags;
    if (!hash || (!input && input_size)) return STATUS_INVALID_PARAMETER;
    sha_update((RockanrolaSha256 *)hash, input, input_size);
    return STATUS_SUCCESS;
}

NTSTATUS BCryptFinishHash(BCRYPT_HASH_HANDLE hash, PUCHAR output,
                          ULONG output_size, ULONG flags) {
    (void)flags;
    if (!hash || !output || output_size != 32u) return STATUS_INVALID_PARAMETER;
    sha_final((RockanrolaSha256 *)hash, output);
    return STATUS_SUCCESS;
}

NTSTATUS BCryptDestroyHash(BCRYPT_HASH_HANDLE hash) {
    if (hash) memset(hash, 0, sizeof(RockanrolaSha256));
    return STATUS_SUCCESS;
}

NTSTATUS BCryptCloseAlgorithmProvider(BCRYPT_ALG_HANDLE algorithm,
                                      ULONG flags) {
    (void)flags;
    return algorithm == &g_algorithm_token ? STATUS_SUCCESS
                                           : STATUS_INVALID_PARAMETER;
}
