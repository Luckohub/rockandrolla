/*
 * Rockanrola web port - portable subset of the BCrypt hashing API.
 * Only SHA-256 and the calls made by rnr_app_core.c are provided.
 */
#ifndef ROCKANROLA_SHIM_BCRYPT_H
#define ROCKANROLA_SHIM_BCRYPT_H

#include "windows.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void *BCRYPT_ALG_HANDLE;
typedef void *BCRYPT_HASH_HANDLE;
typedef void *BCRYPT_HANDLE;

#define BCRYPT_SHA256_ALGORITHM L"SHA256"
#define BCRYPT_OBJECT_LENGTH L"ObjectLength"

NTSTATUS BCryptOpenAlgorithmProvider(BCRYPT_ALG_HANDLE *algorithm,
                                     LPCWSTR algorithm_id,
                                     LPCWSTR implementation, ULONG flags);
NTSTATUS BCryptGetProperty(BCRYPT_HANDLE object, LPCWSTR property,
                           PUCHAR output, ULONG output_size,
                           ULONG *result_size, ULONG flags);
NTSTATUS BCryptCreateHash(BCRYPT_ALG_HANDLE algorithm,
                          BCRYPT_HASH_HANDLE *hash, PUCHAR hash_object,
                          ULONG hash_object_size, PUCHAR secret,
                          ULONG secret_size, ULONG flags);
NTSTATUS BCryptHashData(BCRYPT_HASH_HANDLE hash, PUCHAR input,
                        ULONG input_size, ULONG flags);
NTSTATUS BCryptFinishHash(BCRYPT_HASH_HANDLE hash, PUCHAR output,
                          ULONG output_size, ULONG flags);
NTSTATUS BCryptDestroyHash(BCRYPT_HASH_HANDLE hash);
NTSTATUS BCryptCloseAlgorithmProvider(BCRYPT_ALG_HANDLE algorithm,
                                      ULONG flags);

/* Direct one-shot helper used by the web glue and tests. */
void rockanrola_sha256(const void *data, size_t size, uint8_t digest[32]);

#ifdef __cplusplus
}
#endif
#endif
