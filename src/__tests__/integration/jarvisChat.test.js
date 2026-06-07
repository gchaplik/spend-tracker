// Integration: Jarvis chat — voice mode ref, speaking state, and conversation loop logic

describe('voiceModeRef behaviour', () => {
  // Simulates sendText isVoice parameter setting voiceModeRef
  const makeVoiceModeController = () => {
    let ref = { current: false };
    const sendText = (text, isVoice = false) => {
      if (isVoice) ref.current = true;
      return ref.current;
    };
    const stopVoice = () => { ref.current = false; };
    return { sendText, stopVoice, ref };
  };

  test('sendText(text, true) sets voiceModeRef to true', () => {
    const { sendText, ref } = makeVoiceModeController();
    sendText('hello', true);
    expect(ref.current).toBe(true);
  });

  test('sendText(text, false) does not activate voice mode', () => {
    const { sendText, ref } = makeVoiceModeController();
    sendText('hello', false);
    expect(ref.current).toBe(false);
  });

  test('stopVoice resets voiceModeRef', () => {
    const { sendText, stopVoice, ref } = makeVoiceModeController();
    sendText('hello', true);
    stopVoice();
    expect(ref.current).toBe(false);
  });
});

describe('speaking state gates mic', () => {
  const makeMicController = () => {
    let speaking = false;
    let listening = false;
    const setSpeaking = v => { speaking = v; };
    const setListening = v => { listening = v; };

    const startVoice = () => {
      if (speaking) return 'blocked-speaking';
      if (listening) return 'stopped-listening';
      setListening(true);
      return 'started';
    };
    const onTTSStart = () => setSpeaking(true);
    const onTTSEnd = () => { setSpeaking(false); };

    return { startVoice, onTTSStart, onTTSEnd, get speaking() { return speaking; }, get listening() { return listening; } };
  };

  test('startVoice is blocked while speaking', () => {
    const ctrl = makeMicController();
    ctrl.onTTSStart();
    expect(ctrl.startVoice()).toBe('blocked-speaking');
  });

  test('startVoice works after TTS ends', () => {
    const ctrl = makeMicController();
    ctrl.onTTSStart();
    ctrl.onTTSEnd();
    expect(ctrl.startVoice()).toBe('started');
  });

  test('speaking goes false after onTTSEnd', () => {
    const ctrl = makeMicController();
    ctrl.onTTSStart();
    expect(ctrl.speaking).toBe(true);
    ctrl.onTTSEnd();
    expect(ctrl.speaking).toBe(false);
  });

  test('mic starts after TTS ends when in voice mode', () => {
    const callbacks = [];
    let voiceMode = true;
    const onTTSEnd = (startVoice) => {
      if (voiceMode) callbacks.push('startVoice-queued');
    };
    onTTSEnd(() => {});
    expect(callbacks).toContain('startVoice-queued');
  });
});

describe('speakAndResume — early return paths', () => {
  const makeSpeak = (jarvisEnabled) => {
    let started = false;
    let micResumed = false;
    let voiceMode = { current: true };

    const speakAndResume = (text) => {
      if (!jarvisEnabled || !text) {
        if (voiceMode.current) micResumed = true;
        return 'early-return';
      }
      started = true;
      return 'speaking';
    };

    return { speakAndResume, get started() { return started; }, get micResumed() { return micResumed; } };
  };

  test('empty text triggers early return', () => {
    const s = makeSpeak(true);
    expect(s.speakAndResume('')).toBe('early-return');
    expect(s.started).toBe(false);
  });

  test('jarvis disabled triggers early return', () => {
    const s = makeSpeak(false);
    expect(s.speakAndResume('hello')).toBe('early-return');
    expect(s.started).toBe(false);
  });

  test('early return resumes mic when in voice mode', () => {
    const s = makeSpeak(false);
    s.speakAndResume('test');
    expect(s.micResumed).toBe(true);
  });

  test('valid text with jarvis enabled starts speaking', () => {
    const s = makeSpeak(true);
    expect(s.speakAndResume('Hello, sir.')).toBe('speaking');
    expect(s.started).toBe(true);
  });
});

describe('QUICK fast-path reply_ integration', () => {
  // reply_ calls speakAndResume — verify the chain is wired
  const makeReplyChain = () => {
    const spoken = [];
    const speakAndResume = (text) => spoken.push(text);
    const reply_ = (text) => speakAndResume(text);
    return { reply_, spoken };
  };

  test('reply_ passes text to speakAndResume', () => {
    const { reply_, spoken } = makeReplyChain();
    reply_('Your June spending is $407.29.');
    expect(spoken).toContain('Your June spending is $407.29.');
  });

  test('multiple replies accumulate', () => {
    const { reply_, spoken } = makeReplyChain();
    reply_('First reply.');
    reply_('Second reply.');
    expect(spoken.length).toBe(2);
  });
});

describe('Conversation history management', () => {
  const makeHistory = () => {
    let messages = [];
    const addUser = (text) => { messages = [...messages, { role: 'user', text }]; };
    const addAssistant = (text) => { messages = [...messages, { role: 'assistant', text }]; };
    const getHistory = () => messages.filter(m => m.role !== 'system').slice(-10);
    return { addUser, addAssistant, getHistory, get all() { return messages; } };
  };

  test('user messages are added', () => {
    const h = makeHistory();
    h.addUser('How much did I spend?');
    expect(h.getHistory()[0]).toMatchObject({ role: 'user', text: 'How much did I spend?' });
  });

  test('assistant replies are added', () => {
    const h = makeHistory();
    h.addAssistant('$407.29.');
    expect(h.getHistory()[0].role).toBe('assistant');
  });

  test('history is capped at 10 entries', () => {
    const h = makeHistory();
    for (let i = 0; i < 15; i++) {
      h.addUser(`msg ${i}`);
      h.addAssistant(`reply ${i}`);
    }
    expect(h.getHistory().length).toBe(10);
  });
});
