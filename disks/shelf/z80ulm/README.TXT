Z80-uLM
=======

A conversational model small enough for a Z80: it hashes what you type
into 128 trigram buckets, runs it through a network of 2-bit weights with
16-bit integer maths, and writes its answer one character at a time. It
does not understand you, and it fits in about 40K.

Chat:         CHAT        (type a short line; try "hello", "are you a
                           robot", "do you dream"; it answers tersely)
20 questions: GUESS       (or PLAY) the model knows a secret topic and
                           answers your yes/no questions with YES, NO or
                           MAYBE. Guess it to WIN. What the topic
                           is, it is not telling.

An answer can take a few seconds at 4 MHz: 8 MHz or max, in the front
strip, is quicker.

CHAT.COM   the chat example (tinychat), release v0.2.
GUESS.COM  the 20 questions example, release v0.2.
PLAY.COM   types GUESS at the CP/M prompt, so you need not.

Z80-uLM is by HarryR: github.com/HarryR/z80ai (the .COM files are from
its release v0.2, unchanged). Its README says: "License: MIT or
Apache-2.0 as you see fit." Training your own model is in that project's
TRAINING.md.
