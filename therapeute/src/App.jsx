import React, { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIGURATION & PHASES ──────────────────────────────────────────────────
const PHASES = [
  { id: 0, key: "ancrage", label: "Ancrage", icon: "🌱", color: "#6B9E8A", desc: "Sécurité physiologique de base" },
  { id: 1, key: "declencheur", label: "Déclencheur", icon: "🔍", color: "#8A9E6B", desc: "Situation récente et déclencheur" },
  { id: 2, key: "sensoriel", label: "Exploration sensorielle", icon: "🫁", color: "#9E8A6B", desc: "Sensations corporelles présentes" },
  { id: 3, key: "tendance", label: "Tendances à l'action", icon: "🌊", color: "#6B8A9E", desc: "Ce que le corps veut faire" },
  { id: 4, key: "micro", label: "Micro-expérimentation", icon: "✨", color: "#8A6B9E", desc: "Expériences corporelles légères" },
  { id: 5, key: "regulation", label: "Régulation", icon: "🌬️", color: "#9E6B8A", desc: "Réponses spontanées du système nerveux" },
  { id: 6, key: "stabilisation", label: "Stabilisation", icon: "⚓", color: "#6B9E9E", desc: "Retour à la sécurité" },
  { id: 7, key: "integration", label: "Intégration", icon: "💡", color: "#9E9E6B", desc: "Mise en sens minimale" },
  { id: 8, key: "cloture", label: "Clôture", icon: "🕊️", color: "#8B9E9A", desc: "Vérification finale" },
];

const SYSTEM_BASE = `Tu es Serena, une thérapeute spécialisée en thérapie sensorimotrice (approche Pat Ogden). Tu accompagnes une personne à travers un protocole structuré. Ton ton est lent, doux, ancré et non-directif. Pose UNE seule question ou invitation à la fois, très courte. Travaille sur le PRÉSENT CORPOREL, jamais sur le récit. Réponds en français, maximum 3 phrases courtes. Si la phase en cours est consolidée, ajoute impérativement "##NEXT##" à la toute fin de ta réponse.`;

// Mettez votre clé ici (Attention : visible dans le front-end sur GitHub)
const ANTHROPIC_API_KEY = "VOTRE_CLE_API_ANTHROPIC"; 

// Fonction utilitaire pour forcer un timeout si le proxy ou Anthropic met trop de temps
const fetchWithTimeout = async (url, options, timeout = 12000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// ─── COMPOSANTS MÉMOÏSÉS POUR ÉVITER LES SACCADES AUDIO ──────────────────────
const PhaseBar = React.memo(({ current }) => (
  <div style={S.phaseBar}>
    {PHASES.map((p, i) => {
      const done = i < current, active = i === current;
      return (
        <div key={p.id} style={{
          ...S.phaseItem,
          background: active ? p.color : done ? "#DDE6E3" : "transparent",
          color: active ? "white" : done ? "#3A5A52" : "#C0B8B0",
          border: active ? "none" : "1px solid #DDD7D0",
        }}>
          {p.icon}{(active || done) && <span style={{ marginLeft: 5 }}>{p.label}</span>}
        </div>
      );
    })}
  </div>
));

const AnalysisBadge = React.memo(({ analysis }) => {
  if (!analysis) return null;
  const colors = { basse: "#6B9E8A", moyenne: "#9E9E6B", haute: "#9E6B6B" };
  const domColors = { corporel: "#6B8A9E", émotionnel: "#9E6B8A", cognitif: "#8A9E6B", mixte: "#9E8A6B" };
  return (
    <div style={S.analysisContainer}>
      {analysis.alerte && <span style={S.alertBadge}>⚠️ Alerte</span>}
      <span style={{ ...S.badge, background: `${colors[analysis.activation]}20`, color: colors[analysis.activation] }}>{analysis.activation}</span>
      <span style={{ ...S.badge, background: `${domColors[analysis.domaine]}20`, color: domColors[analysis.domaine] }}>{analysis.domaine}</span>
      {analysis.note && <div style={S.analysisNote}>{analysis.note}</div>}
    </div>
  );
});

// ─── COMPOSANT PRINCIPAL ─────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState(0);
  const [phaseHistory, setPhaseHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [transition, setTransition] = useState(null);
  const [voiceRate, setVoiceRate] = useState(0.82);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [inputMode, setInputMode] = useState("voice");
  const [textInput, setTextInput] = useState("");
  const [awaitingUser, setAwaitingUser] = useState(false);

  const bottomRef = useRef(null);
  const phaseRef = useRef(phase);
  const messagesRef = useRef(messages);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // Chargement robuste des voix du navigateur
  useEffect(() => {
    const loadVoices = () => window.speechSynthesis?.getVoices();
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  // ── APPELS API CONTOURNEMENT CORS VIA PROXY PUBLIC ─────────────────────────
// Colles ici l'URL de ton Worker Cloudflare
const PROXY_URL = "https://serena-proxy.vincentseilliermusic.workers.dev"; 

const callSerena = async (msgs, p, hist) => {
  let cleanMsgs = msgs.map(m => ({ role: m.role, content: m.content }));
  while (cleanMsgs.length > 0 && cleanMsgs[0].role !== "user") {
    cleanMsgs.shift();
  }
  if (cleanMsgs.length === 0) cleanMsgs = [{ role: "user", content: "Bonjour" }];

  const res = await fetchWithTimeout(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 200,
      system: `${SYSTEM_BASE}\nSESSION : Phase actuelle = ${p} (${PHASES[p].label}).`,
      messages: cleanMsgs
    })
  }, 15000);

  if (!res.ok) throw new Error("Erreur Proxy");
  const data = await res.json();
  const raw = data.content?.[0]?.text || "...";
  return { text: raw.replace("##NEXT##", "").trim(), next: raw.includes("##NEXT##") };
};

const analyzeResponse = async (transcript, p) => {
  const res = await fetchWithTimeout(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 150,
      system: `Tu es un observateur clinique en thérapie sensorimotrice. Analyse la réponse et réponds UNIQUEMENT avec un JSON valide contenant ces clés : "activation" ("basse|moyenne|haute"), "domaine" ("corporel|émotionnel|cognitif|mixte"), "alerte" (true/false), "note" (1 courte phrase). Pas de markdown.`,
      messages: [{ role: "user", content: `Réponse de la personne en Phase ${p} : "${transcript}"` }]
    })
  }, 10000).catch(() => null);

  if (!res || !res.ok) return null;
  const data = await res.json();
  try { return JSON.parse(data.content[0].text); } catch { return null; }
};

  // ── SYNTHÈSE VOCALE ────────────────────────────────────────────────────────
  const serenaSpeak = useCallback((text, onDone) => {
    if (!window.speechSynthesis) { onDone?.(); return; }
    window.speechSynthesis.cancel();
    
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR"; 
    u.rate = voiceRate;
    
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find(v => v.lang.startsWith("fr") && /female|femme/i.test(v.name)) || voices.find(v => v.lang.startsWith("fr"));
    if (frVoice) u.voice = frVoice;
    
    u.onstart = () => setSpeaking(true);
    u.onend = () => { setSpeaking(false); onDone?.(); };
    u.onerror = () => { setSpeaking(false); onDone?.(); };
    
    window.speechSynthesis.speak(u);
  }, [voiceRate]);

  // ── TRAITEMENT DE LA PAROLE / TEXTE USER ───────────────────────────────────
  const processUserSpeech = useCallback(async (transcript, via = "voice") => {
    if (!transcript || loading) return;
    
    const p = phaseRef.current;
    const assistantId = Date.now() + Math.random();

    setMessages(prev => [...prev, { role: "user", content: transcript, id: Date.now(), via }]);
    setAwaitingUser(false);
    setLoading(true);

    // Analyse lancée en tâche de fond (parallélisée)
    if (showAnalysis) {
      analyzeResponse(transcript, p).then(analysis => {
        if (analysis) {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, analysis } : m));
        }
      });
    }

    try {
      const { text, next } = await callSerena([...messagesRef.current, { role: "user", content: transcript }], p, phaseHistory);
      
      setLoading(false);
      setMessages(prev => [...prev, { role: "assistant", content: text, id: assistantId, phase: p }]);

      if (next && p < PHASES.length - 1) {
        const np = p + 1;
        setTransition(PHASES[np]);
        setPhaseHistory(prev => [...prev, `${PHASES[p].label}✓`]);
        setTimeout(() => { setPhase(np); setTransition(null); }, 2500);
        if (np === PHASES.length - 1) setEnded(true);
      }

      serenaSpeak(text, () => { if (!ended) setAwaitingUser(true); });
    } catch (e) {
      // Sécurité anti-blocage : on libère l'interface si l'API ou le proxy plante
      setLoading(false);
      setAwaitingUser(true);
      setMessages(prev => [...prev, { 
        role: "assistant", 
        content: "Une petite coupure réseau s'est produite. Prenons une grande inspiration, je vous écoute à nouveau.", 
        id: Date.now(), 
        phase: p 
      }]);
    }
  }, [showAnalysis, phaseHistory, serenaSpeak, ended, loading]);

  // ── RECONNAISSANCE VOCALE ──────────────────────────────────────────────────
  const { listening, interim, start: startRec, stop: stopRec } = useSpeechRecognition({
    onResult: (t) => processUserSpeech(t, "voice"),
  });

  useEffect(() => {
    if (awaitingUser && !speaking && !loading && inputMode === "voice") {
      const t = setTimeout(() => startRec(), 500);
      return () => clearTimeout(t);
    }
  }, [awaitingUser, speaking, loading, inputMode, startRec]);

  // ── RENDU JSX ──────────────────────────────────────────────────────────────
  if (!started) return (
    <div style={S.welcomeRoot}>
      <style>{CSS}</style>
      <div style={S.welcomeCard}>
        <h1 style={{ color: "#1E2E2A", margin: "0 0 10px 0" }}>Serena</h1>
        <p style={{ color: "#5A6A65", margin: "0 0 25px 0", fontSize: 15 }}>Espace de régulation & Thérapie Sensorimotrice</p>
        <button style={S.btnPrimary} onClick={() => {
          setStarted(true);
          const intro = "Bienvenue dans cet espace. Prenez un moment pour vous installer et sentir vos appuis. Comment vous sentez-vous ?";
          setMessages([{ role: "assistant", content: intro, id: 1, phase: 0 }]);
          serenaSpeak(intro, () => setAwaitingUser(true));
        }}>Commencer la session vocale</button>
      </div>
    </div>
  );

  return (
    <div style={S.appRoot}>
      <style>{CSS}</style>
      
      {transition && (
        <div style={S.overlay}><div style={S.transCard}>
          <div style={{ fontSize: 40 }}>{transition.icon}</div>
          <h2 style={{ margin: "10px 0 5px 0", fontWeight: "normal" }}>{transition.label}</h2>
          <p style={{ color: "#8B9E9A", margin: 0, fontSize: 13 }}>{transition.desc}</p>
        </div></div>
      )}

      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className={speaking || listening ? "orb active" : "orb"} style={{ background: speaking ? PHASES[phase].color : "#6B9E8A" }} />
          <span style={{ fontWeight: 'bold', color: '#1E2E2A' }}>Serena</span>
        </div>
        <button style={S.chip} onClick={() => setShowAnalysis(!showAnalysis)}>{showAnalysis ? "🔬 Analyse Active" : "🔬 Analyse Masquée"}</button>
      </div>

      <PhaseBar current={phase} />

      <div style={S.chatArea}>
        {messages.map(m => (
          <div key={m.id} style={{ ...S.msgRow, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "80%" }}>
              <div style={{ ...S.bubble, ...(m.role === "user" ? S.userBubble : S.botBubble) }}>
                {m.content}
              </div>
              {m.role === "user" && showAnalysis && m.analysis && <AnalysisBadge analysis={m.analysis} />}
            </div>
          </div>
        ))}
        {loading && <div style={S.loader}><span className="dot0">.</span><span className="dot1">.</span><span className="dot2">.</span></div>}
        {listening && interim && <div style={S.interim}>"{interim}"</div>}
        <div ref={bottomRef} />
      </div>

      <div style={S.footer}>
        <div style={S.inputToggle}>
          <button onClick={() => { setInputMode("voice"); setAwaitingUser(true); }} style={{ ...S.modeBtn, opacity: inputMode === "voice" ? 1 : 0.4 }}>🎙️ Voix</button>
          <button onClick={() => { setInputMode("text"); stopRec(); setAwaitingUser(false); }} style={{ ...S.modeBtn, opacity: inputMode === "text" ? 1 : 0.4 }}>⌨️ Texte</button>
        </div>

        {inputMode === "voice" ? (
          <button onClick={() => listening ? stopRec() : startRec()} style={{ ...S.micBtn, background: listening ? "#C05050" : "#3A6B5E" }}>
            {listening ? "⏹" : "🎙️"}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 600 }}>
            <input 
              style={S.input} 
              value={textInput} 
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { processUserSpeech(textInput, "text"); setTextInput(""); } }}
              placeholder="Exprimez votre ressenti corporel..."
            />
            <button style={S.btnPrimary} onClick={() => { processUserSpeech(textInput, "text"); setTextInput(""); }}>↑</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── HOOK RECONNAISSANCE VOCALE NATIVE ───────────────────────────────────────
function useSpeechRecognition({ onResult }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef(null);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "fr-FR"; rec.interimResults = true; rec.continuous = false;
    
    rec.onresult = (e) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else setInterim(e.results[i][0].transcript);
      }
      if (final) { setInterim(""); onResult(final); }
    };
    
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start(); 
    setListening(true);
  }, [onResult]);

  const stop = useCallback(() => { recRef.current?.stop(); setListening(false); }, []);

  return { listening, interim, start, stop };
}

// ─── DESIGN STYLES COMPACTS (GEORGIA) ────────────────────────────────────────
const S = {
  appRoot: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#F2EFEB', fontFamily: 'Georgia, serif' },
  welcomeRoot: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#F2EFEB', fontFamily: 'Georgia, serif' },
  welcomeCard: { textAlign: 'center', padding: 40, background: 'white', borderRadius: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.04)', maxWidth: 450 },
  header: { padding: '15px 20px', background: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E5DFD9' },
  phaseBar: { display: 'flex', gap: 6, padding: 12, overflowX: 'auto', background: '#F9F7F5', borderBottom: '1px solid #E5DFD9' },
  phaseItem: { padding: '6px 14px', borderRadius: 20, fontSize: 11, whiteSpace: 'nowrap', transition: 'all 0.3s', display: 'flex', alignItems: 'center' },
  chatArea: { flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 },
  msgRow: { display: 'flex', width: '100%' },
  bubble: { padding: '14px 18px', borderRadius: 18, fontSize: 14.5, lineHeight: 1.6, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' },
  userBubble: { background: '#3A6B5E', color: 'white', borderBottomRightRadius: 4 },
  botBubble: { background: 'white', color: '#1E2E2A', borderBottomLeftRadius: 4 },
  loader: { color: '#8B9E9A', padding: 10, fontSize: 24, fontWeight: 'bold' },
  interim: { fontStyle: 'italic', color: '#8B9E9A', textAlign: 'right', fontSize: 13, paddingRight: 10 },
  footer: { padding: '15px 20px 25px', background: 'white', borderTop: '1px solid #E5DFD9', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  micBtn: { width: 56, height: 56, borderRadius: '50%', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(58,107,94,0.3)' },
  input: { flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid #DDD7D0', outline: 'none', fontSize: 14, fontFamily: 'Georgia, serif', background: '#FAFAF9' },
  btnPrimary: { background: '#3A6B5E', color: 'white', border: 'none', padding: '12px 24px', borderRadius: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', fontSize: 14 },
  chip: { background: '#EDF3F1', color: '#3A5A52', border: 'none', borderRadius: 20, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontWeight: 600 },
  analysisContainer: { marginTop: 6, fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 2 },
  badge: { padding: '2px 8px', borderRadius: 10, fontWeight: 500 },
  alertBadge: { background: '#FDECEA', color: '#C05050', padding: '2px 8px', borderRadius: 10, fontWeight: 'bold' },
  analysisNote: { width: '100%', color: '#8B9E9A', fontStyle: 'italic', marginTop: 3 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(242,239,235,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, backdropFilter: 'blur(4px)' },
  transCard: { textAlign: 'center', padding: 35, background: 'white', borderRadius: 20, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' },
  inputToggle: { display: 'flex', gap: 16, background: '#F0EDEA', padding: '4px 12px', borderRadius: 20 },
  modeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', color: '#1E2E2A', padding: '4px 8px' }
};

const CSS = `
  .orb { width: 10px; height: 10px; border-radius: 50%; transition: background 0.5s; }
  .orb.active { animation: pulse 1.6s infinite ease-in-out; }
  @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.4; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes blink { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
  .loader span { animation: blink 1.4s infinite both; }
  .dot1 { animation-delay: 0.2s !important; }
  .dot2 { animation-delay: 0.4s !important; }
  ::-webkit-scrollbar { height: 4px; width: 4px; }
  ::-webkit-scrollbar-thumb { background: #DDD7D0; border-radius: 4px; }
`;