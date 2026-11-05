/*
 * fortune.js: the board's fortune cookies: hacker koans, science fiction,
 * retro computing. All written for this board, plain ASCII, one or two short
 * lines each.
 *
 *   pick(random, avoid)   a fortune's index not in `avoid` (the last few shown)
 */
(function (root) {
    'use strict';

    const FORTUNES = [
        // koans and aphorisms of the trade
        'The best exploit is a well-read manual.',
        'A hacker is someone who reads the error message to the end.',
        'There is no cloud. There is only somebody else\'s CP/M machine.',
        'Every system is secure until someone reads the source.',
        'Trust, but verify. Then verify the verifier.',
        'Root is a state of mind. Backups are a state of grace.',
        'The signal is in the noise. So, usually, is the bug.',
        'Never debug a problem you can reproduce with a smaller problem.',
        'A password is a promise you make to a machine that cannot forgive.',
        'It is not a bug if you called it a feature in the manual. It is a lawsuit.',
        'The oldest bug in the world: a human at the keyboard. Be kind to the human.',
        'He who controls the checksum controls the file.',
        'First, make it work. Second, make it right. Third, make it 8080-compatible.',
        'Weeks of coding can save you hours of reading the documentation.',
        'The fastest code is the code that was never run.',
        'In a world of zero days, be a thirty-year-old CP/M program: nobody is attacking you.',
        'Think twice, type once, commit never at 5 PM on a Friday.',
        'Security is a process. Insecurity is a habit with a good alibi.',
        'The cat on the keyboard has found more bugs than the test suite.',
        'A firewall is a fence around the wrong problem.',
        'You can hide from the logs, but not from yourself at 3 AM.',
        'If it can be done with a shell script, it was probably already done in 1983.',
        'The hardest part of hacking is explaining to the family why it was not a crime.',
        'Knowledge wants to be free. Documentation wants to be written.',
        'Curiosity is the only master key. Please do not lose it.',
        // science fiction
        'The ship\'s computer is never wrong. It is only very sure about the wrong thing.',
        'First contact will be a handshake at 1200 baud. Be patient.',
        'Out past the relay the signals drift. Tune gently.',
        'You will receive a message from the future. Check its checksum.',
        'The robots are not coming for your job. They are coming for your meetings.',
        'Somewhere a machine is dreaming of electric sheep and getting the count wrong.',
        'The AI says it understands. The AI says many things. Check the logs.',
        'All of this has happened before. Fortunately, it was backed up.',
        'The universe is a very large lookup table. Nobody has found the index.',
        'In space no one can hear you reboot. Wait the full ninety seconds.',
        'The android asked for a coffee. It did not drink it. It wanted to be asked.',
        'Time travel works. The bug reports arrive before the bugs.',
        'A sufficiently advanced bulletin board is indistinguishable from a small town.',
        'The aliens are fluent in all protocols. They are only bad at timeouts.',
        'When the last human logs off, the machines will keep the board running. Just in case.',
        'A lighthouse is just a very slow modem.',
        'Your digital twin has been getting better reviews than you.',
        'The terraforming is going well. The coffee machine is still a mystery.',
        'Somewhere in the dark a probe is still sending you a very polite greeting.',
        'The singularity is delayed pending a firmware update.',
        'The warp drive works. It is the pull request that takes ten years.',
        // retro computing
        'A 64K machine is a cathedral of small rooms.',
        'Your next bug lives at 0100h.',
        'ED is a text editor the way a canoe is a boat.',
        'XMODEM never forgets. It only retries ten times.',
        'May your disk be sectored and your skew kind.',
        'In the beginning was the prompt, and the prompt was A>.',
        'PIP is a very good friend and a very bad listener.',
        'The Z80 is an 8080 that went to night school.',
        'At 1200 baud there is time to read as the page comes in. This was the point.',
        'Eight bits are enough for anyone who has learned to count in hex.',
        'Hexadecimal is just decimal that has seen things.',
        'Blessed are the CP/M users, for they shall have no surprises, nor any memory.',
        'A floppy disk holds 250 kilobytes and a lifetime of regret.',
        'Warm boot: the polite way of saying \'try again\'.',
        'Real programmers do not comment their code. They carve it in 8-bit stone.',
        'Every great program began as a bad idea and a free evening.',
        'May all your interrupts be vectored and your stack never overflow.',
        'The phosphor glows. The cursor blinks. The night shift goes on.',
        'Somewhere a sysop is waiting for a call. Be that call.',
        'Dial a stranger. Say hello. Hang up politely. That is called telephony.',
        'A modem is a machine that turns music into mail and mail into music.',
        'The beep and the hiss: the sound of a door opening on the other side of the world.',
        'Zork is not a game. It is a way of life, and it is dark, and you may be eaten by a grue.',
        'A 300 baud modem proves that patience is a technology.',
        // cyberpunk and the net
        'The net is a vast and lonely sea. Bring a lamp. Bring a friend.',
        'Neon flickers on the wet street. Somewhere a server hums to itself.',
        'Data wants a home with a good backup.',
        'A ghost in the machine is only a process you forgot to kill.',
        'Information is the one resource that grows when you share it.',
        'They sold you the cloud. Remember, there is a basement under it, full of fans.',
        'Corporations may own the cables, but nobody owns the idea.',
        'Your packet will arrive, though its journey will be long and mostly unlit.',
        'If your digital life flashes before your eyes, make sure it was backed up.',
        'The best firewall is an unplugged cable and a good book.',
        'A hacker, a poet and a locksmith walk into a library. They all leave with the same book.',
        'Somewhere in the stack a function is crying. Please call it by its right name.',
        'Wear the black hat in the morning, the white hat in the afternoon, and the old cardigan at night.',
        // wargames-ish and cold war
        'A strange game. The only winning move is not to play.',
        'The mainframe is calm. It has already played the game ten million times.',
        'Shall we play a game? Not today. Today we write a bulletin.',
        'Love your neighbor, patch your server, and never press the red button.',
        'Peace is a protocol with excellent uptime and no marketing.',
        // luck and love
        'You will find the bug where you least expect it: in the line you were sure about.',
        'A pleasant surprise awaits you in the next block of the file.',
        'Someone out there is thinking of you, and they have a spare disk.',
        'The code you are about to write has already been written. Look harder.',
        'Your talent is a soldering iron: warm, sharp and best used in good light.',
        'You will meet a tall, dark stranger. It will be a rack of servers.',
        'Today a small thing will go right. Savor it like a clean compile.',
        'Good news is coming in a packet. It may be delayed. It will not be lost.',
        'The night is long, the line is clear, and the carrier is steady. Go on.'
    ];

    /** The index of a fortune other than those in `avoid`. */
    function pick(random = Math.random, avoid = []) {
        const room = FORTUNES.map((_, i) => i).filter(i => !avoid.includes(i));
        const from = room.length ? room : FORTUNES.map((_, i) => i);
        return from[Math.floor(random() * from.length) % from.length];
    }

    const api = { FORTUNES, pick };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
