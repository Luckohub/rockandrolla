/*
 * Rockanrola web port - minimal <windows.h> replacement.
 *
 * The upstream frontend file frontend/windows/rnr_app_core.c is compiled
 * unmodified for WebAssembly. Its only Windows dependency is ROM SHA-256
 * verification through BCrypt. This header supplies just the integer types
 * that file uses; bcrypt.h supplies a portable SHA-256 behind the BCrypt API.
 * Never place this directory on the include path of a real Windows build.
 */
#ifndef ROCKANROLA_SHIM_WINDOWS_H
#define ROCKANROLA_SHIM_WINDOWS_H

#ifdef _WIN32
#error "port/shim/windows.h is only for non-Windows (WebAssembly) builds"
#endif

#include <stddef.h>
#include <stdint.h>
#include <wchar.h>

typedef uint32_t DWORD;
typedef uint32_t ULONG;
typedef unsigned char UCHAR;
typedef UCHAR *PUCHAR;
typedef int32_t NTSTATUS;
typedef const wchar_t *LPCWSTR;

#endif
