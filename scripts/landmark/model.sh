#!/bin/sh
# A model for tests: no network, no key, the same reply every time.
#
# It plays the one conversation the landmark tests need (scripts/landmark.sh). Asked the
# question, it writes a program and asks for it to be run; shown the program's result, it
# answers with it. So a test that gets "30007" back knows the whole loop ran: the engine
# read the reply, the tool ran the program on this build's runtime, and the result came back.
#
#   sh model.sh "<the prompt the engine built>"
case "$1" in
*30007*)
    printf 'summary: Report the sum the program gave\nanswer: The sum of the squares of the first 20 primes is 30007.\n'
    ;;
*)
    printf 'summary: Work the sum out with a program\nact: [run_code(code: "[2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71].reduce((a, p) => a + p * p, 0)", language: "js")]\n'
    ;;
esac
