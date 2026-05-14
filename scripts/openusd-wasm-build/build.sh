#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
source ~/emsdk/emsdk_env.sh

rm -f openusd.js openusd.wasm openusd.data openusd.worker.js

LIBDIR=/home/kauanfortunato/wasm/openusd-wasm-official/lib
INCDIR=/home/kauanfortunato/wasm/openusd-wasm-official/include

em++ wrapper.cpp \
  -std=c++17 \
  -DPXR_STATIC \
  -I"$INCDIR" \
  -Wl,--whole-archive \
  "$LIBDIR/libusd_usd.a" \
  "$LIBDIR/libusd_usdGeom.a" \
  "$LIBDIR/libusd_usdShade.a" \
  "$LIBDIR/libusd_sdr.a" \
  "$LIBDIR/libusd_kind.a" \
  "$LIBDIR/libusd_sdf.a" \
  "$LIBDIR/libusd_pcp.a" \
  "$LIBDIR/libusd_plug.a" \
  "$LIBDIR/libusd_work.a" \
  "$LIBDIR/libusd_tf.a" \
  "$LIBDIR/libusd_arch.a" \
  "$LIBDIR/libusd_js.a" \
  "$LIBDIR/libusd_trace.a" \
  "$LIBDIR/libusd_vt.a" \
  "$LIBDIR/libusd_gf.a" \
  "$LIBDIR/libusd_ar.a" \
  "$LIBDIR/libusd_ts.a" \
  "$LIBDIR/libusd_pegtl.a" \
  -Wl,--no-whole-archive \
  "$LIBDIR/libtbb.a" \
  --bind \
  --preload-file "$LIBDIR/usd@/usd" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=64MB \
  -s MAXIMUM_MEMORY=2GB \
  -s ENVIRONMENT=web \
  -s FORCE_FILESYSTEM=1 \
  -s ASSERTIONS=1 \
  -s EXIT_RUNTIME=0 \
  -s EMULATE_FUNCTION_POINTER_CASTS=1 \
  -s EXPORTED_RUNTIME_METHODS='["FS","ccall","cwrap","UTF8ToString","stringToUTF8","HEAPU8","HEAP32","HEAPF32","writeArrayToMemory"]' \
  -o openusd.js

echo
echo "Build OK. Output:"
ls -lh openusd.js openusd.wasm openusd.data 2>/dev/null || true
