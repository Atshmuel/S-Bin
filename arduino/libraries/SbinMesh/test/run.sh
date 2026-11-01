#!/bin/sh
# Builds and runs the mesh tests (authentication, join) on this computer.
set -e
cd "$(dirname "$0")"
LIBS=""
[ "$(uname)" = "Darwin" ] || LIBS="-lcrypto"
c++ -std=c++17 -Wall -Wextra -I ../src auth_test.cpp hmac_host.cpp ../src/SbinMeshAuth.cpp ../src/SbinMeshKeyUpdate.cpp $LIBS -o /tmp/sbinmesh_auth_test
/tmp/sbinmesh_auth_test
c++ -std=c++17 -Wall -Wextra -I ../src join_test.cpp hmac_host.cpp ../src/SbinMeshAuth.cpp ../src/SbinMeshKeyUpdate.cpp ../src/SbinMeshJoin.cpp $LIBS -o /tmp/sbinmesh_join_test
/tmp/sbinmesh_join_test
c++ -std=c++17 -Wall -Wextra -I ../src key_update_test.cpp hmac_host.cpp ../src/SbinMeshAuth.cpp ../src/SbinMeshKeyUpdate.cpp $LIBS -o /tmp/sbinmesh_key_update_test
/tmp/sbinmesh_key_update_test
