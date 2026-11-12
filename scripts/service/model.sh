#!/bin/sh
# The landmark's scripted model (scripts/landmark/model.sh), taking a moment over each reply
# as a real model does, so that a run lasts long enough to be watched while it happens
# (scripts/service.sh).
#
#   sh model.sh "<the prompt the engine built>"
sleep 1
exec sh "$(dirname "$0")/../landmark/model.sh" "$1"
