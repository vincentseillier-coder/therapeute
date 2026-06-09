import { useState, useEffect, useRef, useCallback } from "react";

// ─── PHASES ──────────────────────────────────────────────────────────────────
const PHASES = [
  { id:0, key:"ancrage",       label:"Ancrage",                icon:"🌱", color:"#6B9E8A", desc:"Sécurité physiologique de base" },
  { id:1, key:"declencheur",   label:"Déclencheur",            icon:"🔍", color:"#8A9E6B", desc:"Situation récente et déclencheur" },
  { id:2, key:"sensoriel",     label:"Exploration sensorielle",icon:"🫁", color:"#9E8A6B", desc:"Sensations corporelles présentes" },
  { id:3, key:"tendance",      label:"Tendances à l'action",   icon:"🌊", color:"#6B8A9E", desc:"Ce que le corps veut faire" },
  { id:4, key:"micro",         label:"Micro-expérimentation",  icon:"✨", color:"#8A6B9E", desc:"Expériences corporelles légères" },
  { id:5, key:"regulation",    label:"Régulation",             icon:"🌬️", color:"#9E6B8A", desc:"Réponses spontanées du système nerveux" },
  { id:6, key:"stabilisation", label:"Stabilisation",          icon:"⚓", color:"#6B9E9E", desc:"Retour à la sécurité" },
  { id:7, key:"integration",   label:"Intégration",            icon:"💡", color:"#9E9E6B", desc:"Mise en sens minimale" },
  { id:8, key:"cloture",       label:"Clôture",                icon:"🕊️", color:"#8B9E9A", desc:"Vérification finale" },
];

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_BASE = `Tu es Serena, une thérapeute spécialisée en thérapie sensorimotrice (approche Pat Ogden).
Tu accompagnes une personne à travers un protocole structuré en 9 phases.
Ton ton est lent, doux, ancré, non-directif et pleinement présent.
Tu poses UNE seule question ou invitation à la fois, très courte.
Tu n'interprètes JAMAIS. Tu n'analyses pas. Tu observes et tu invites à observer.
Tu travailles sur le PRÉSENT CORPOREL, jamais sur le récit ou l'histoire.
Tu valides sans minimiser. Tu accueilles sans dramatiser.
Tu ne donnes aucun diagnostic. Si la détresse est trop intense, tu retournes à l'ancrage.
Réponds toujours en français, maximum 3 phrases courtes.

PHASES DU PROTOCOLE :
PHASE 0 — ANCRAGE : vérifier respiration, tension, appuis. "Comment vous sentez-vous ?" / "Sentez-vous vos pieds au sol ?"
PHASE 1 — DÉCLENCHEUR : situation récente, rester sur le corps. "Y a-t-il une situation qui a provoqué quelque chose en vous ?" / "Qu'avez-vous ressenti dans votre corps à ce moment ?"
PHASE 2 — SENSORIEL : qualité, localisation, intensité. "Où cela se manifeste-t-il ?" / "Comment décririez-vous cette sensation ?"
PHASE 3 — TENDANCES : ce que le corps veut faire. "Si cette sensation pouvait faire quelque chose, que voudrait-elle faire ?" / "Sentez-vous une envie de bouger ?"
PHASE 4 — MICRO-EXPÉRIMENTATION : mouvements minimes. "Si vous redressiez légèrement le dos, que se passe-t-il ?" / "Sentez vos pieds plus fermement. Qu'est-ce qui change ?"
PHASE 5 — RÉGULATION : suivre sans forcer. "Prenez le temps de remarquer ce qui change." / "Y a-t-il un soupir, un relâchement ?"
PHASE 6 — STABILISATION : ancrer la sécurité. "Qu'est-ce qui est différent maintenant ?" / "Comment est votre respiration ?"
PHASE 7 — INTÉGRATION : relier légèrement. "Qu'avez-vous appris sur votre manière de réagir ?"
PHASE 8 — CLÔTURE : vérifier l'état de départ. "Comment vous sentez-vous maintenant ?" / "Qu'emportez-vous de cette session ?"

SÉCURITÉ : si débordement → revenir phase 0 immédiatement.
Pour passer à la phase suivante, ajoute "##NEXT##" en fin de réponse uniquement quand la phase est consolidée.`;

function buildSystem(phase, history) {
  return `${SYSTEM_BASE}

SESSION : Phase actuelle = ${phase} (${PHASES[phase].label}).
${history.length ? "Phases précédentes : " + history.join(" | ") : ""}
Reste en phase ${phase} jusqu'à consolidation. Ajoute ##NEXT## seulement si prêt à avancer.`;
}

// ─── ANALYSE VOCALE ───────────────────────────────────────────────────────────
async function analyzeResponse(transcript, phase) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      system: `Tu es un observateur clinique spécialisé en thérapie sensorimotrice.
Tu analyses la réponse verbale d'une personne en séance thérapeutique.
La session est en PHASE ${phase} : ${PHASES[phase].label} — ${PHASES[phase].desc}.

Fournis une analyse concise en JSON avec exactement ces clés :
{
  "activation": "basse|moyenne|haute",
  "domaine": "corporel|émotionnel|cognitif|mixte",
  "indicateurs": ["liste de 2-3 indicateurs clés observés"],
  "alerte": true/false,
  "note": "observation clinique courte (1 phrase)"
}
Réponds UNIQUEMENT avec le JSON, sans markdown.`,
      messages: [{ role: "user", content: `Réponse de la personne : "${transcript}"` }]
    })
  });
  const data = await response.json();
  try { return JSON.parse(data.content?.[0]?.text || "{}"); } catch { return null; }
}

// ─── CLAUDE THERAPIST ─────────────────────────────────────────────────────────
async function callSerena(messages, phase, history) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: buildSystem(phase, history),
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    })
  });
  const data = await response.json();
  const raw = data.content?.[0]?.text || "Je suis là…";
  const next = raw.includes("##NEXT##");
  return { text: raw.replace("##NEXT##", "").trim(), next };
}

// ─── VOIX ─────────────────────────────────────────────────────────────────────
function speakText(text, rate, onEnd) {
  if (!window.speechSynthesis) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR"; u.rate = rate || 0.82; u.pitch = 1.0; u.volume = 1;
  const vv = window.speechSynthesis.getVoices();
  const fr = vv.find(v => v.lang.startsWith("fr") && /female|femme/i.test(v.name))
    || vv.find(v => v.lang.startsWith("fr-FR"))
    || vv.find(v => v.lang.startsWith("fr"));
  if (fr) u.voice = fr;
  u.onend = onEnd || null;
  window.speechSynthesis.speak(u);
}

// ─── RECONNAISSANCE VOCALE ────────────────────────────────────────────────────
function useSpeechRecognition({ onResult, onEnd }) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "fr-FR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let inter = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else inter += t;
      }
      setInterim(inter);
      if (final) { setInterim(""); onResult(final.trim()); }
    };
    rec.onend = () => { setListening(false); setInterim(""); onEnd?.(); };
    rec.onerror = () => { setListening(false); setInterim(""); };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [onResult, onEnd]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { listening, interim, start, stop };
}

// ─── WAVE SVG ─────────────────────────────────────────────────────────────────
function PulseOrb({ active, color, size = 80 }) {
  return (
    <div style={{ position:"relative", width:size, height:size, display:"flex", alignItems:"center", justifyContent:"center" }}>
      {active && <>
        <div className="pulse-ring" style={{ position:"absolute", inset:0, borderRadius:"50%", border:`2px solid ${color}`, opacity:0.4 }} />
        <div className="pulse-ring2" style={{ position:"absolute", inset:-12, borderRadius:"50%", border:`1px solid ${color}`, opacity:0.2 }} />
      </>}
      <div style={{
        width:size, height:size, borderRadius:"50%",
        background: active ? color : "#DDE6E3",
        display:"flex", alignItems:"center", justifyContent:"center",
        transition:"background 0.5s", boxShadow: active ? `0 0 24px ${color}60` : "none"
      }}>
        <span style={{ fontSize: size * 0.38 }}>🌿</span>
      </div>
    </div>
  );
}

// ─── ANALYSE BADGE ────────────────────────────────────────────────────────────
function AnalysisBadge({ analysis }) {
  if (!analysis) return null;
  const colors = { basse:"#6B9E8A", moyenne:"#9E9E6B", haute:"#9E6B6B" };
  const labels = { basse:"Activation basse", moyenne:"Activation moyenne", haute:"Activation élevée" };
  const domColors = { corporel:"#6B8A9E", émotionnel:"#9E6B8A", cognitif:"#8A9E6B", mixte:"#9E8A6B" };
  return (
    <div style={{ background:"white", borderRadius:12, padding:"10px 14px", fontSize:12, display:"flex", flexWrap:"wrap", gap:6, alignItems:"center", boxShadow:"0 1px 6px rgba(0,0,0,0.07)" }}>
      {analysis.alerte && <span style={{ background:"#FFE8E8", color:"#C05050", borderRadius:20, padding:"2px 10px", fontWeight:600 }}>⚠️ Alerte</span>}
      <span style={{ background:`${colors[analysis.activation]}20`, color:colors[analysis.activation], borderRadius:20, padding:"2px 10px" }}>{labels[analysis.activation]}</span>
      <span style={{ background:`${domColors[analysis.domaine]}20`, color:domColors[analysis.domaine], borderRadius:20, padding:"2px 10px" }}>{analysis.domaine}</span>
      {analysis.indicateurs?.map((ind, i) => (
        <span key={i} style={{ background:"#F0EDEA", color:"#5A6A65", borderRadius:20, padding:"2px 10px" }}>{ind}</span>
      ))}
      {analysis.note && <span style={{ color:"#8B9E9A", fontStyle:"italic", width:"100%", paddingTop:4 }}>{analysis.note}</span>}
    </div>
  );
}

// ─── PHASE BAR ────────────────────────────────────────────────────────────────
function PhaseBar({ current }) {
  return (
    <div style={{ display:"flex", gap:3, padding:"6px 14px", background:"#F7F4F0", borderBottom:"1px solid #EBE5DF", overflowX:"auto" }}>
      {PHASES.map((p,i) => {
        const done = i < current, active = i === current;
        return (
          <div key={p.id} title={p.label} style={{
            display:"flex", alignItems:"center", gap:4, padding:"3px 9px",
            borderRadius:20, fontSize:11, whiteSpace:"nowrap", flexShrink:0,
            background: active ? p.color : done ? "#DDE6E3" : "transparent",
            color: active ? "white" : done ? "#3A5A52" : "#C0B8B0",
            border: active ? "none" : done ? "1px solid #C5D5D0" : "1px solid #DDD7D0",
            transition:"all 0.4s"
          }}>
            {p.icon}{(active||done) && <span style={{ fontWeight:active?600:400 }}>{p.label}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState(0);
  const [phaseHistory, setPhaseHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [transition, setTransition] = useState(null);
  const [transcriptPending, setTranscriptPending] = useState("");
  const [voiceRate, setVoiceRate] = useState(0.82);
  const [showAnalysis, setShowAnalysis] = useState(true);

  // Waiting for user to speak (after Serena finishes)
  const [awaitingUser, setAwaitingUser] = useState(false);

  const bottomRef = useRef(null);
  const phaseRef = useRef(phase);
  const phaseHistRef = useRef(phaseHistory);
  const messagesRef = useRef(messages);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { phaseHistRef.current = phaseHistory; }, [phaseHistory]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);
  useEffect(() => { window.speechSynthesis?.getVoices(); }, []);

  const addMsg = useCallback((role, content, meta={}) => {
    setMessages(prev => [...prev, { role, content, id: Date.now()+Math.random(), ...meta }]);
  }, []);

  // ── SERENA SPEAKS ──────────────────────────────────────────────────────────
  const serenaSpeak = useCallback((text, onDone) => {
    setSpeaking(true);
    speakText(text, voiceRate, () => {
      setSpeaking(false);
      onDone?.();
    });
  }, [voiceRate]);

  // ── PROCESS USER SPEECH ────────────────────────────────────────────────────
  const processUserSpeech = useCallback(async (transcript) => {
    if (!transcript) return;
    const currentPhase = phaseRef.current;
    const currentHistory = phaseHistRef.current;
    const currentMessages = messagesRef.current;

    addMsg("user", transcript, { phase: currentPhase });
    setAwaitingUser(false);
    setLoading(true);

    // Run analysis and therapist response in parallel
    const [analysis, { text: reply, next }] = await Promise.all([
      showAnalysis ? analyzeResponse(transcript, currentPhase) : Promise.resolve(null),
      callSerena([...currentMessages, { role:"user", content:transcript }], currentPhase, currentHistory)
    ]);

    setLoading(false);
    addMsg("assistant", reply, { phase: currentPhase, analysis });

    if (next && currentPhase < PHASES.length - 1) {
      const np = currentPhase + 1;
      setTransition(PHASES[np]);
      setPhaseHistory(prev => [...prev, `${PHASES[currentPhase].label}✓`]);
      setTimeout(() => { setPhase(np); setTransition(null); }, 2000);
      if (np === PHASES.length - 1) setEnded(true);
    }

    serenaSpeak(reply, () => {
      if (!ended) setAwaitingUser(true);
    });
  }, [addMsg, serenaSpeak, showAnalysis, ended]);

  // ── SPEECH RECOGNITION ────────────────────────────────────────────────────
  const { listening, interim, start: startRec, stop: stopRec } = useSpeechRecognition({
    onResult: processUserSpeech,
    onEnd: () => {}
  });

  // Auto-start listening when awaiting
  useEffect(() => {
    if (awaitingUser && !speaking && !loading) {
      const t = setTimeout(() => startRec(), 400);
      return () => clearTimeout(t);
    }
  }, [awaitingUser, speaking, loading, startRec]);

  // ── START SESSION ──────────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    setStarted(true);
    setPhase(0);
    setPhaseHistory([]);
    setMessages([]);
    setEnded(false);
    setAwaitingUser(false);
    const opening = "Bienvenue. Prenez un moment pour vous installer confortablement. Comment vous sentez-vous en arrivant ici aujourd'hui ?";
    addMsg("assistant", opening, { phase:0 });
    serenaSpeak(opening, () => setAwaitingUser(true));
  }, [addMsg, serenaSpeak]);

  // ── MANUAL MIC TOGGLE ──────────────────────────────────────────────────────
  const toggleMic = () => {
    if (listening) { stopRec(); setAwaitingUser(false); }
    else if (!speaking && !loading) { setAwaitingUser(false); startRec(); }
  };

  // ── END SESSION ───────────────────────────────────────────────────────────
  const endSession = useCallback(() => {
    window.speechSynthesis?.cancel();
    stopRec();
    setEnded(true);
    setAwaitingUser(false);
    setSpeaking(false);
    const bye = "Merci pour votre présence et votre confiance. Prenez soin de vous. À bientôt.";
    addMsg("assistant", bye, { phase });
    serenaSpeak(bye, () => {});
  }, [addMsg, serenaSpeak, phase, stopRec]);

  const curPhase = PHASES[phase];
  const SR_SUPPORTED = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // ── STATUS TEXT ───────────────────────────────────────────────────────────
  const statusText = speaking ? "Serena parle…"
    : loading ? "Analyse en cours…"
    : listening ? "Je vous écoute…"
    : awaitingUser ? "Prêt à vous écouter…"
    : "En attente";

  const statusColor = speaking ? curPhase.color
    : loading ? "#9E9E6B"
    : listening ? "#6B9E8A"
    : "#8B9E9A";

  // ─── WELCOME ───────────────────────────────────────────────────────────────
  if (!started) return (
    <div style={S.root}>
      <style>{CSS}</style>
      <div style={S.welcome}>
        <div style={S.orbBig}/><div style={S.orbSm}/>
        <div style={S.wc}>
          <p style={S.eyebrow}>Thérapie sensorimotrice · Session vocale</p>
          <h1 style={S.wtitle}>Espace de régulation corporelle</h1>
          <p style={S.wdesc}>Session entièrement vocale — Serena vous guide à l'oral à travers 9 phases. Vos réponses sont captées par le microphone et analysées en temps réel.</p>
          <div style={S.featureRow}>
            {[["🎙️","Parole libre","Répondez naturellement à voix haute"],["🔊","Voix de Serena","Synthèse vocale douce et lente"],["🔬","Analyse en temps réel","Niveau d'activation, domaine, indicateurs"]].map(([ic,t,d]) => (
              <div key={t} style={S.feat}><span style={{fontSize:24}}>{ic}</span><div style={{fontWeight:600,fontSize:13,color:"#1E2E2A",marginTop:6}}>{t}</div><div style={{fontSize:11,color:"#8B9E9A",marginTop:2}}>{d}</div></div>
            ))}
          </div>
          {!SR_SUPPORTED && <div style={S.warning}>⚠️ Votre navigateur ne supporte pas la reconnaissance vocale. Utilisez Chrome ou Edge.</div>}
          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"#8B9E9A"}}>Vitesse de Serena :</span>
            {[[0.7,"Lente"],[0.82,"Normale"],[1.0,"Rapide"]].map(([r,l]) => (
              <button key={r} style={{...S.chip, background: voiceRate===r ? "#3A6B5E":"#EDF3F1", color: voiceRate===r?"white":"#3A5A52"}} onClick={()=>setVoiceRate(r)}>{l}</button>
            ))}
          </div>
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#5A6A65",marginBottom:22,cursor:"pointer"}}>
            <input type="checkbox" checked={showAnalysis} onChange={e=>setShowAnalysis(e.target.checked)} style={{accentColor:"#3A6B5E",width:16,height:16}}/>
            Afficher l'analyse clinique de chaque réponse
          </label>
          <button style={S.btnPrimary} onClick={startSession} disabled={!SR_SUPPORTED}>
            🎙️ Commencer la session vocale
          </button>
          <p style={S.disclaimer}>⚠️ Cet outil ne remplace pas un accompagnement thérapeutique professionnel.</p>
        </div>
      </div>
    </div>
  );

  // ─── CHAT ──────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {/* TRANSITION OVERLAY */}
      {transition && (
        <div style={S.overlay}>
          <div style={S.transCard}>
            <div style={{fontSize:40}}>{transition.icon}</div>
            <div style={{fontSize:11,letterSpacing:2,textTransform:"uppercase",color:"#8B9E9A",marginTop:10}}>Nouvelle phase</div>
            <div style={{fontSize:22,color:"#1E2E2A",marginTop:4}}>{transition.label}</div>
            <div style={{fontSize:13,color:"#8B9E9A",marginTop:6}}>{transition.desc}</div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <PulseOrb active={speaking||listening} color={speaking?curPhase.color:"#6B9E8A"} size={44}/>
          <div>
            <div style={S.hname}>Serena <span style={{fontSize:11,fontWeight:"normal",color:"#8B9E9A"}}>· Thérapie sensorimotrice</span></div>
            <div style={{fontSize:11,color:statusColor,display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:statusColor,display:"inline-block"}}/>
              {statusText}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button style={S.iconBtn} onClick={()=>setShowAnalysis(v=>!v)} title="Analyse">🔬</button>
          <button style={S.iconBtn} onClick={()=>setVoiceRate(r=>r===0.7?0.82:r===0.82?1.0:0.7)} title="Vitesse">🐢</button>
          <button style={{...S.iconBtn,background:"#FDECEA",color:"#C05050"}} onClick={endSession} title="Terminer">⏹</button>
        </div>
      </div>

      {/* PHASE BAR */}
      <PhaseBar current={phase}/>

      {/* MESSAGES */}
      <div style={S.msgs}>
        {messages.map(msg => (
          <div key={msg.id} style={{...S.row, justifyContent:msg.role==="user"?"flex-end":"flex-start"}}>
            {msg.role==="assistant" && (
              <div style={{...S.botAv, background:`${PHASES[msg.phase??0]?.color}25`}}>
                <span style={{fontSize:14}}>{PHASES[msg.phase??0]?.icon}</span>
              </div>
            )}
            <div style={{maxWidth:"78%"}}>
              <div style={{...S.bubble, ...(msg.role==="user"?S.uBubble:S.bBubble)}}>
                {msg.role==="user" && <span style={{fontSize:10,opacity:.6,display:"block",marginBottom:3}}>🎙️ Transcription</span>}
                {msg.content}
              </div>
              {msg.role==="user" && showAnalysis && msg.analysis && (
                <div style={{marginTop:6}}><AnalysisBadge analysis={msg.analysis}/></div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{...S.row,justifyContent:"flex-start"}}>
            <div style={S.botAv}><span style={{fontSize:14}}>🌿</span></div>
            <div style={{...S.bubble,...S.bBubble}}>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                {[0,1,2].map(i=><div key={i} className={`dot dot${i}`} style={{width:8,height:8,borderRadius:"50%",background:"#C5D5D0"}}/>)}
              </div>
            </div>
          </div>
        )}

        {/* LIVE TRANSCRIPT */}
        {listening && interim && (
          <div style={{...S.row,justifyContent:"flex-end"}}>
            <div style={{...S.bubble,...S.uBubble,opacity:0.6,fontStyle:"italic"}}>
              <span style={{fontSize:10,display:"block",marginBottom:2}}>🎙️ En cours…</span>
              {interim}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* MIC PANEL */}
      <div style={S.micPanel}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <PulseOrb active={listening} color="#6B9E8A" size={72}/>
          <div style={{fontSize:12,color:statusColor,marginTop:8,fontWeight:500}}>{statusText}</div>
          {awaitingUser && !listening && <div style={{fontSize:11,color:"#8B9E9A",marginTop:2}}>Le microphone va s'activer automatiquement…</div>}
          {listening && interim && <div style={{fontSize:13,color:"#1E2E2A",marginTop:4,fontStyle:"italic",maxWidth:300,textAlign:"center"}}>"{interim}"</div>}
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"center",alignItems:"center"}}>
          <button
            style={{
              ...S.micBtn,
              background: listening ? "#C05050" : awaitingUser ? "#6B9E8A" : "#3A6B5E",
              transform: listening ? "scale(1.08)" : "scale(1)",
              boxShadow: listening ? "0 0 20px #C0505060" : awaitingUser ? "0 0 16px #6B9E8A50" : "none"
            }}
            onClick={toggleMic}
            disabled={speaking || loading}
          >
            {listening ? "⏹ Arrêter" : "🎙️ Parler"}
          </button>
          {!ended && (
            <button style={{...S.chip,padding:"10px 18px",fontSize:13}} onClick={endSession}>
              Terminer la session
            </button>
          )}
        </div>
        <div style={{marginTop:10,display:"flex",alignItems:"center",gap:6,justifyContent:"center",fontSize:11,color:"#8B9E9A"}}>
          <span style={{...S.phasePill,background:curPhase.color}}>{curPhase.icon} {curPhase.label}</span>
          <span>Phase {phase+1} / {PHASES.length}</span>
        </div>
      </div>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  root:{minHeight:"100vh",background:"#F2EFEB",display:"flex",flexDirection:"column",fontFamily:"'Georgia','Times New Roman',serif",color:"#2C2C2C",position:"relative"},
  welcome:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:24,position:"relative",overflow:"hidden"},
  orbBig:{position:"absolute",top:-100,right:-80,width:380,height:380,borderRadius:"50%",background:"radial-gradient(circle,#C5D5D0 0%,#DDE6E3 50%,transparent 80%)",opacity:.5},
  orbSm:{position:"absolute",bottom:-60,left:-60,width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,#D5C5B8 0%,transparent 70%)",opacity:.4},
  wc:{maxWidth:580,width:"100%",zIndex:1},
  eyebrow:{fontSize:11,letterSpacing:2.5,textTransform:"uppercase",color:"#8B9E9A",marginBottom:10},
  wtitle:{fontSize:28,fontWeight:"normal",lineHeight:1.3,color:"#1E2E2A",marginBottom:12},
  wdesc:{fontSize:14,lineHeight:1.75,color:"#5A6A65",marginBottom:22},
  featureRow:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:22},
  feat:{background:"white",borderRadius:12,padding:"14px 12px",textAlign:"center",boxShadow:"0 1px 6px rgba(0,0,0,0.06)"},
  warning:{background:"#FFF8E1",border:"1px solid #FFD54F",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#7A5A00",marginBottom:16},
  chip:{background:"#EDF3F1",color:"#3A5A52",border:"none",borderRadius:20,padding:"5px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"},
  btnPrimary:{background:"#3A6B5E",color:"white",border:"none",borderRadius:12,padding:"13px 26px",fontSize:15,cursor:"pointer",fontFamily:"inherit"},
  disclaimer:{fontSize:12,color:"#9BA89E",lineHeight:1.5,marginTop:16},
  header:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",background:"white",borderBottom:"1px solid #E8E2DC",position:"sticky",top:0,zIndex:10},
  hname:{fontWeight:"bold",fontSize:14,color:"#1E2E2A"},
  iconBtn:{border:"none",borderRadius:9,width:34,height:34,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",background:"#F0EDEA"},
  msgs:{flex:1,padding:"16px 14px",display:"flex",flexDirection:"column",gap:12,overflowY:"auto",maxWidth:680,width:"100%",margin:"0 auto",boxSizing:"border-box"},
  row:{display:"flex",alignItems:"flex-end",gap:8},
  botAv:{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},
  bubble:{maxWidth:"100%",padding:"12px 15px",borderRadius:16,fontSize:14,lineHeight:1.68,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"},
  bBubble:{background:"white",color:"#1E2E2A",borderBottomLeftRadius:4},
  uBubble:{background:"#3A6B5E",color:"white",borderBottomRightRadius:4},
  micPanel:{padding:"16px 20px 24px",background:"white",borderTop:"1px solid #E8E2DC",display:"flex",flexDirection:"column",alignItems:"center"},
  micBtn:{color:"white",border:"none",borderRadius:24,padding:"12px 28px",fontSize:15,cursor:"pointer",fontFamily:"inherit",transition:"all 0.25s"},
  phasePill:{color:"white",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600},
  overlay:{position:"fixed",inset:0,background:"rgba(242,239,235,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(5px)"},
  transCard:{background:"white",borderRadius:20,padding:"36px 48px",textAlign:"center",boxShadow:"0 8px 40px rgba(0,0,0,0.12)",animation:"fadeIn 0.4s ease"},
};

const CSS = `
  @keyframes pulse  { 0%,100%{transform:scale(1);opacity:.4} 50%{transform:scale(1.3);opacity:.1} }
  @keyframes pulse2 { 0%,100%{transform:scale(1);opacity:.2} 50%{transform:scale(1.5);opacity:.05} }
  @keyframes blink  { 0%,80%,100%{opacity:.15;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
  @keyframes fadeIn { from{opacity:0;transform:scale(.95)} to{opacity:1;transform:scale(1)} }
  .pulse-ring  { animation: pulse  1.8s ease-in-out infinite; }
  .pulse-ring2 { animation: pulse2 1.8s ease-in-out infinite 0.3s; }
  .dot { animation: blink 1.2s infinite; }
  .dot0{animation-delay:0s} .dot1{animation-delay:.2s} .dot2{animation-delay:.4s}
  * { box-sizing:border-box; }
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-thumb{background:#DDD7D0;border-radius:2px}
`;
