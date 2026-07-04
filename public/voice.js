// Agente C — Interfaz de voz (Web Speech API: STT + TTS, sin servicios externos)

(() => {
  const $ = sel => document.querySelector(sel);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SR && 'speechSynthesis' in window;

  const state = {
    listening: false,
    alertsOn: true,
    lastAlertId: 0,
    pending: null, // acción esperando confirmación verbal { type, payload, speech }
  };

  // ---------- TTS ----------

  let esVoice = null;
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    esVoice = voices.find(v => /es[-_](MX|419|US)/i.test(v.lang))
      ?? voices.find(v => /^es/i.test(v.lang))
      ?? null;
  }
  if (supported) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function speak(text, { interrupt = true } = {}) {
    if (!supported) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (esVoice) u.voice = esVoice;
    u.lang = esVoice?.lang ?? 'es-MX';
    u.rate = 1.05;
    u.onstart = () => setStatus('hablando');
    u.onend = () => setStatus(state.listening ? 'escuchando' : 'inactivo');
    speechSynthesis.speak(u);
    log('ia', text);
  }

  // ---------- STT ----------

  let recognition = null;
  function startListening() {
    if (!supported || state.listening) return;
    recognition = new SR();
    recognition.lang = 'es-MX';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = e => {
      const text = e.results[0][0].transcript.trim();
      log('user', text);
      handleCommand(text.toLowerCase());
    };
    recognition.onend = () => {
      state.listening = false;
      $('#voice-mic').classList.remove('listening');
      setStatus('inactivo');
    };
    recognition.onerror = e => {
      if (e.error === 'not-allowed') speak('Necesito permiso de micrófono para escucharte.');
      state.listening = false;
      $('#voice-mic').classList.remove('listening');
    };
    recognition.start();
    state.listening = true;
    $('#voice-mic').classList.add('listening');
    setStatus('escuchando');
  }

  // ---------- Panel ----------

  function setStatus(s) {
    const el = $('#voice-status');
    if (el) el.textContent = s;
  }

  function log(who, text) {
    const el = $('#voice-log');
    if (!el) return;
    const div = document.createElement('div');
    div.className = `voice-msg ${who}`;
    div.textContent = (who === 'user' ? '🗣️ ' : '🤖 ') + text;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 30) el.removeChild(el.firstChild);
  }

  // ---------- Intents ----------

  const NUM_WORDS = {
    'cero': 0, 'medio': 0.5, 'media': 0.5, 'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4,
    'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'veinte': 20,
    'cien': 100, 'mil': 1000,
  };

  function parseNumber(s) {
    s = s.trim().toLowerCase().replace('punto', '.').replace('coma', '.');
    // "cero . cinco" → "0.5"
    const parts = s.split(/\s+/).map(w => NUM_WORDS[w] ?? w).join('');
    const n = Number(parts.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function brief(type, id) {
    setStatus('consultando…');
    const url = `/api/voice/brief?type=${type}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
    const { speech } = await (await fetch(url)).json();
    speak(speech);
  }

  async function handleCommand(text) {
    try {
      // Confirmación pendiente
      if (state.pending) {
        if (/\b(sí|si|confirmo|dale|correcto|adelante|hazlo)\b/.test(text)) {
          const p = state.pending;
          state.pending = null;
          await executePending(p);
        } else if (/\b(no|cancela|olvídalo|olvidalo)\b/.test(text)) {
          state.pending = null;
          speak('Operación cancelada.');
        } else {
          speak('No entendí. Di sí para confirmar o no para cancelar.');
        }
        return;
      }

      // Alertas on/off
      if (/\b(activa|enciende)\b.*alertas/.test(text)) {
        state.alertsOn = true;
        $('#voice-alerts-toggle').checked = true;
        return speak('Alertas proactivas activadas. Te avisaré por voz cuando detecte eventos de mercado.');
      }
      if (/\b(desactiva|apaga|silencia)\b.*alertas/.test(text)) {
        state.alertsOn = false;
        $('#voice-alerts-toggle').checked = false;
        return speak('Alertas silenciadas.');
      }

      // Cartera
      if (/(cartera|portafolio|portfolio|mis (posiciones|inversiones))/.test(text)) {
        return brief('portfolio');
      }

      // Añadir posición: "añade 0.5 bitcoin a 60000"
      const addMatch = text.match(/(?:añade|agrega|registra|compra)\s+(?:posición\s+(?:de\s+)?)?([\w\s.,]+?)\s+(?:de\s+)?([a-záéíóúñ&\s\d]+?)\s+(?:a|en|precio)\s+([\d.,\s\w]+)$/);
      if (addMatch && /añade|agrega|registra|compra/.test(text)) {
        const qty = parseNumber(addMatch[1]);
        const assetId = window.assetFromSpeechClient?.(addMatch[2]);
        const price = parseNumber(addMatch[3]);
        if (qty && assetId && price) {
          const asset = window.findAssetClient(assetId);
          state.pending = {
            type: 'add',
            payload: { assetType: asset.type, assetId, symbol: asset.symbol, name: asset.name, quantity: qty, buyPrice: price },
          };
          return speak(`¿Confirmas añadir ${qty} de ${asset.name} a ${price.toLocaleString('es-ES')} dólares? Di sí o no.`);
        }
        return speak('No pude entender la posición. Di por ejemplo: añade cero punto cinco de bitcoin a sesenta mil.');
      }

      // Eliminar posición: "elimina la posición de bitcoin"
      const delMatch = text.match(/(?:elimina|borra|quita|cierra)\s+(?:la\s+)?posición\s+(?:de\s+)?([a-záéíóúñ&\s\d]+)/);
      if (delMatch) {
        const assetId = window.assetFromSpeechClient?.(delMatch[1]);
        if (!assetId) return speak('No identifiqué el activo a eliminar.');
        const invs = await (await fetch('/api/investments')).json();
        const inv = invs.find(i => i.assetId === assetId);
        if (!inv) return speak(`No tienes posiciones de ${delMatch[1].trim()} en la cartera.`);
        state.pending = { type: 'delete', payload: { id: inv.id, name: inv.name } };
        return speak(`¿Confirmas eliminar tu posición de ${inv.quantity} ${inv.symbol}? Di sí o no.`);
      }

      // Análisis de activo: "análisis de bitcoin", "cómo va apple"
      const assetQ = text.match(/(?:análisis|analiza|analisis|cómo va|como va|qué tal|que tal|estado de)\s+(?:de\s+|el\s+|la\s+)?([a-záéíóúñ&\s\d]+)/);
      if (assetQ) {
        const assetId = window.assetFromSpeechClient?.(assetQ[1]);
        if (assetId) return brief('asset', assetId);
      }

      // Informe general / oportunidades
      if (/(informe|resumen|apertura|mercado|oportunidad|recomendaci)/.test(text)) {
        return brief('market');
      }

      // Fallback → pregunta libre a Ollama (si está)
      setStatus('pensando…');
      const res = await fetch('/api/voice/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      const { speech } = await res.json();
      speak(speech);
    } catch (e) {
      speak('Hubo un error procesando el comando.');
      console.error(e);
    }
  }

  async function executePending(p) {
    if (p.type === 'add') {
      const res = await fetch('/api/investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.payload),
      });
      if (res.ok) {
        speak(`Listo. Posición de ${p.payload.quantity} ${p.payload.symbol} registrada a ${p.payload.buyPrice.toLocaleString('es-ES')} dólares.`);
        window.loadInvestments?.();
      } else {
        speak('No pude registrar la posición.');
      }
    } else if (p.type === 'delete') {
      const res = await fetch(`/api/investments/${p.payload.id}`, { method: 'DELETE' });
      speak(res.ok ? `Posición de ${p.payload.name} eliminada.` : 'No pude eliminar la posición.');
      window.loadInvestments?.();
    }
  }

  // ---------- Alertas proactivas ----------

  async function pollAlerts() {
    if (!state.alertsOn) return;
    try {
      const { lastId, alerts } = await (await fetch(`/api/alerts?since=${state.lastAlertId}`)).json();
      if (state.lastAlertId === 0) {
        // Primera carga: no releer historial viejo en voz alta
        state.lastAlertId = lastId;
        return;
      }
      state.lastAlertId = lastId;
      for (const a of alerts.slice(-3)) {
        speak(a.speech, { interrupt: false });
      }
    } catch { /* backend dormido: reintenta al siguiente tick */ }
  }

  // ---------- Init ----------

  function init() {
    if (!supported) {
      const mic = $('#voice-mic');
      if (mic) { mic.title = 'Voz no soportada en este navegador (usa Chrome)'; mic.classList.add('disabled'); }
      return;
    }
    $('#voice-mic').addEventListener('click', () => {
      if ($('#voice-panel').classList.contains('open')) {
        startListening();
      } else {
        $('#voice-panel').classList.add('open');
        speak('Núcleo de inteligencia activo. Puedes pedirme: informe de mercado, resumen de cartera, o análisis de un activo.');
        setTimeout(startListening, 4500);
      }
    });
    $('#voice-close').addEventListener('click', () => {
      $('#voice-panel').classList.remove('open');
      speechSynthesis.cancel();
    });
    $('#voice-alerts-toggle').addEventListener('change', e => { state.alertsOn = e.target.checked; });
    setInterval(pollAlerts, 60_000);
    pollAlerts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
