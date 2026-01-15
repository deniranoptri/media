import React, { useState, useEffect, useRef, useCallback } from 'react';
import Robot from './components/Robot';
import { RobotState } from './types';
import { generateRobotResponse, GeminiResponse } from './services/geminiService';
import { ROBOT_ASSETS } from './constants'; 

const SUGGESTION_CHIPS = [
  "🦄 Dongeng", 
  "🌍 Ibukota", 
  "🧮 Matematika", 
  "📝 Buat Soal", 
  "🚀 Antariksa", 
  "💾 Rangkuman"
];

const SEARCH_HINTS = ["berita", "cuaca", "harga", "skor", "siapa", "dimana", "kapan", "nawin", "tabalong", "haruai", "terbaru", "juara", "pilkada", "google", "cari"];

const App: React.FC = () => {
  const [robotState, setRobotState] = useState<RobotState>(RobotState.IDLE);
  const [transcript, setTranscript] = useState<string>("");
  const [inputValue, setInputValue] = useState<string>(""); 
  const [displayedResponse, setDisplayedResponse] = useState<string>("");
  const [assetsLoaded, setAssetsLoaded] = useState<boolean>(false);
  const [robotScale, setRobotScale] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null); 
  
  const [isSearchingVisual, setIsSearchingVisual] = useState<boolean>(false);

  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [activeKeySource, setActiveKeySource] = useState<"MANUAL" | "HARDCODE" | "NONE">("NONE");

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null); 
  const recognitionRef = useRef<any>(null); 
  const processingRef = useRef<boolean>(false);
  const isMicTogglingRef = useRef<boolean>(false); 
  const containerRef = useRef<HTMLDivElement>(null); 
  const retryTimeoutRef = useRef<number | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);   
  const cameraInputRef = useRef<HTMLInputElement>(null); 

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        synthRef.current = window.speechSynthesis;
    }

    const checkKeyStatus = () => {
        const localKey = localStorage.getItem("gemini_api_key");
        if (localKey && localKey.trim().length > 20) {
            setUserApiKey(localKey);
            setActiveKeySource("MANUAL");
        } else if (process.env.API_KEY && process.env.API_KEY.length > 20 && !process.env.API_KEY.includes("TEMPEL")) {
            setActiveKeySource("HARDCODE");
        } else {
            setActiveKeySource("NONE");
        }
    };
    checkKeyStatus();

    const loadAssets = async () => {
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3000));
      const assetPromises = Object.values(ROBOT_ASSETS).map((src) => {
          return new Promise((resolve) => {
            const img = new Image();
            img.src = src;
            img.onload = resolve;
            img.onerror = resolve; 
          });
      });
      await Promise.race([Promise.all(assetPromises), timeoutPromise]);
      setAssetsLoaded(true);
    };

    loadAssets();

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, [showSettings]);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  const saveApiKey = () => {
    if (userApiKey.trim().length < 20) {
        alert("⚠️ API Key sepertinya terlalu pendek atau tidak valid.");
        return;
    }
    localStorage.setItem("gemini_api_key", userApiKey.trim());
    setActiveKeySource("MANUAL");
    alert("✅ API Key Manual disimpan! Prioritas: INPUT MANUAL.");
    setShowSettings(false);
  };

  const removeApiKey = () => {
    localStorage.removeItem("gemini_api_key");
    setUserApiKey("");
    if (process.env.API_KEY && process.env.API_KEY.length > 20 && !process.env.API_KEY.includes("TEMPEL")) {
        setActiveKeySource("HARDCODE");
    } else {
        setActiveKeySource("NONE");
    }
    alert("🗑️ API Key Manual dihapus. Kembali ke default (jika ada).");
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const ROBOT_WIDTH = 400;
        const ROBOT_HEIGHT = 500;
        const isLandscape = window.innerWidth > window.innerHeight;
        let scale = 1;
        if (isLandscape) {
           const availableHeight = clientHeight - 40;
           const scaleY = availableHeight / ROBOT_HEIGHT;
           const scaleX = clientWidth / ROBOT_WIDTH;
           scale = Math.min(scaleX, scaleY);
        } else {
           const scaleX = (clientWidth - 20) / ROBOT_WIDTH; 
           const scaleY = (clientHeight - 140) / ROBOT_HEIGHT;
           scale = Math.min(scaleX, scaleY);
        }
        scale = Math.min(Math.max(scale, 0.35), 1.25); 
        setRobotScale(scale);
      }
    };
    setTimeout(handleResize, 100);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [assetsLoaded]);

  const safeStopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }
  }, []);

  const handleStop = useCallback(() => {
    if (synthRef.current) synthRef.current.cancel();
    utteranceRef.current = null; 
    safeStopRecognition();
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    processingRef.current = false;
    setRobotState(RobotState.IDLE);
    setIsSearchingVisual(false);
    isMicTogglingRef.current = false;
  }, [safeStopRecognition]);

  const speakResponse = useCallback((text: string) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    
    // Pastikan teks di state update terakhir
    setDisplayedResponse(text); 

    setTimeout(() => {
      if (!synthRef.current) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      utterance.lang = 'id-ID';
      utterance.rate = 1.25; 
      utterance.pitch = 1.1; 
      const voices = synthRef.current.getVoices();
      const targetVoice = voices.find(v => v.lang.includes('id-ID') && v.name.includes('Google')) || voices.find(v => v.lang.includes('id-ID'));
      if (targetVoice) utterance.voice = targetVoice;

      utterance.onstart = () => {
        setRobotState(RobotState.TALKING);
      };
      utterance.onend = () => {
        setRobotState(RobotState.IDLE);
        processingRef.current = false;
        utteranceRef.current = null; 
      };
      utterance.onerror = (e: any) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
            setRobotState(RobotState.IDLE);
            processingRef.current = false;
        }
        utteranceRef.current = null; 
      };
      synthRef.current.speak(utterance);
    }, 50);
  }, []);

  const handleDownloadFile = (fileName: string, content: string) => {
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      alert("Gagal download file.");
    }
  };

  const handleRobotThinking = async (userText: string, isRetry = false) => {
    if (!userText.trim() && !selectedImage && !isRetry) {
      setRobotState(RobotState.IDLE);
      return;
    }

    setRobotState(RobotState.THINKING);
    // HAPUS LOGIKA PEMBERSIHAN DISPLAYED RESPONSE DISINI
    // Agar jika retry, teks lama masih ada sebentar sebelum di-update stream
    if (!isRetry) setDisplayedResponse(""); 
    
    // VISUAL HINT (LUP)
    const lowerPrompt = userText.toLowerCase();
    const looksLikeSearch = SEARCH_HINTS.some(h => lowerPrompt.includes(h)) || (lowerPrompt.endsWith('?') && lowerPrompt.length < 50);
    setIsSearchingVisual(looksLikeSearch && !selectedImage);

    processingRef.current = true;
    
    try {
        // STREAMING REQUEST
        const replyData: GeminiResponse = await generateRobotResponse(
            userText, 
            selectedImage || undefined,
            (partialText) => {
                // UPDATE UI REALTIME - INI KUNCINYA
                setDisplayedResponse(partialText); 
            }
        );
        
        setIsSearchingVisual(false);

        if (replyData.isAuthError) {
             setRobotState(RobotState.IDLE);
             setDisplayedResponse(replyData.text);
             setShowSettings(true); 
             processingRef.current = false;
             return;
        }
        if (replyData.isQuotaError) {
          setRobotState(RobotState.RECHARGING);
          setDisplayedResponse(replyData.text);
          if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = window.setTimeout(() => {
            handleRobotThinking(userText, true);
          }, 8000);
          return; 
        }

        setSelectedImage(null);
        // Mulai bicara setelah stream selesai
        speakResponse(replyData.text);

        if (replyData.file) {
          setTimeout(() => {
            handleDownloadFile(replyData.file!.name, replyData.file!.content);
          }, 1000); 
        }
    } catch (err) {
        setRobotState(RobotState.IDLE);
        setIsSearchingVisual(false);
        setDisplayedResponse("Waduh, sinyal putus nah. Coba lagi lah.");
        processingRef.current = false;
    }
  };

  const handleTextSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputValue.trim() && !selectedImage) || robotState === RobotState.THINKING) return;
    setTranscript(inputValue); 
    handleRobotThinking(inputValue);
    setInputValue(""); 
    (document.activeElement as HTMLElement)?.blur(); 
  };

  const handleChipClick = (text: string) => {
    if (robotState !== RobotState.IDLE) return;
    setInputValue(text);
    setTranscript(text);
    handleRobotThinking(text);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setInputValue("Jelaskan gambar ini Bungas"); 
      };
      reader.readAsDataURL(file);
    }
    e.target.value = ""; 
  };

  const startListening = () => {
    if (isMicTogglingRef.current) return;
    isMicTogglingRef.current = true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser tidak mendukung suara.");
      isMicTogglingRef.current = false;
      return;
    }
    safeStopRecognition(); 
    if (synthRef.current) synthRef.current.cancel();

    setTimeout(() => {
      try {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        let silenceTimer: number;
        recognition.lang = 'id-ID';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        setRobotState(RobotState.LISTENING);
        setTranscript("");
        setDisplayedResponse("");
        processingRef.current = true;

        recognition.onresult = (event: any) => {
          clearTimeout(silenceTimer);
          let interimTranscript = '';
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            else interimTranscript += event.results[i][0].transcript;
          }
          const display = finalTranscript || interimTranscript;
          setTranscript(display);
          setInputValue(display); 

          if (finalTranscript) {
            recognition.stop();
            setInputValue(""); 
            handleRobotThinking(finalTranscript);
            return;
          }
          if (interimTranscript.trim().length > 0) {
              silenceTimer = window.setTimeout(() => {
                  recognition.stop();
                  setInputValue("");
                  handleRobotThinking(interimTranscript);
              }, 1200);
          }
        };

        recognition.onerror = (event: any) => {
          isMicTogglingRef.current = false; 
          clearTimeout(silenceTimer);
          if (event.error !== 'aborted') {
              setDisplayedResponse("Suara tidak terdengar.");
              setRobotState(RobotState.IDLE);
          }
          processingRef.current = false;
        };

        recognition.onend = () => {
          isMicTogglingRef.current = false; 
          clearTimeout(silenceTimer);
          if (recognitionRef.current === recognition) {
             recognitionRef.current = null;
             if (robotState === RobotState.LISTENING) {
                setRobotState(RobotState.IDLE);
                processingRef.current = false;
             }
          }
        };
        recognition.start();
      } catch (e) {
        setRobotState(RobotState.IDLE);
        isMicTogglingRef.current = false; 
      }
    }, 100); 
  };

  useEffect(() => {
    const loadVoices = () => { if (synthRef.current) synthRef.current.getVoices(); };
    loadVoices();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { 
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [handleStop]);

  if (!assetsLoaded) return (
      <div className="h-[100dvh] w-full flex flex-col items-center justify-center font-['Fredoka'] bg-aurora">
        <div className="text-center">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-4 mx-auto"></div>
            <p className="text-blue-500 font-bold animate-pulse">Menyiapkan BUNGAS...</p>
        </div>
      </div>
  );

  const showSendIcon = inputValue.trim().length > 0 || selectedImage !== null;
  const isTalking = robotState === RobotState.TALKING;
  const isThinking = robotState === RobotState.THINKING;
  const isListening = robotState === RobotState.LISTENING;
  const isRecharging = robotState === RobotState.RECHARGING;

  const handleMainButtonClick = () => {
    if (isTalking) handleStop(); 
    else if (isListening) handleStop(); 
    else if (showSendIcon) handleTextSubmit(); 
    else startListening(); 
  };

  return (
    <div className="h-[100dvh] w-full font-['Fredoka'] overflow-hidden relative selection:bg-blue-200">
      <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" style={{ display: 'none' }} />
      <input type="file" ref={cameraInputRef} onChange={handleImageUpload} accept="image/*" capture={"environment" as any} style={{ display: 'none' }} />

      <div className="absolute top-[-100px] left-[-100px] w-80 h-80 bg-blue-300 rounded-full blur-[80px] opacity-30 pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-[-100px] right-[-100px] w-96 h-96 bg-purple-300 rounded-full blur-[80px] opacity-30 pointer-events-none animate-pulse" style={{animationDelay: '2s'}}></div>

      {/* HEADER */}
      <div className="absolute top-0 left-0 right-0 p-4 z-50 flex justify-between items-start pointer-events-none">
        <div className="flex gap-2 pointer-events-auto relative z-50">
          <button onClick={() => setShowSettings(true)} className="p-2.5 glass-panel rounded-full text-blue-600 hover:bg-white/80 transition-all hover:scale-105 active:scale-95">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
          <button onClick={() => setShowInfo(true)} className="p-2.5 glass-panel rounded-full text-blue-600 hover:bg-white/80 transition-all hover:scale-105 active:scale-95">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          </button>
        </div>

        <div className="absolute top-4 left-0 w-full flex flex-col items-center pointer-events-none z-40">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-500 drop-shadow-sm tracking-tight">BUNGAS</h1>
            <p className="text-[0.6rem] sm:text-[0.65rem] font-bold text-blue-400/80 tracking-wider -mt-1">BOT UNGGULAN ASISTEN SEMUA</p>
        </div>

        <button onClick={toggleFullscreen} className="p-2.5 glass-panel rounded-full text-blue-600 pointer-events-auto hover:bg-white/80 transition-all hover:scale-105 active:scale-95 relative z-50">
           <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
        </button>
      </div>

      {/* --- SETTINGS & INFO MODALS --- */}
      {showSettings && (
        <div className="absolute inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="glass-panel bg-white/90 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-gradient-to-r from-blue-50/50 to-gray-50/50 p-5 flex justify-between items-center border-b border-white/50 flex-none">
              <h2 className="text-lg font-bold flex items-center gap-2 text-gray-700">⚙️ Pengaturan</h2>
              <button onClick={() => setShowSettings(false)} className="hover:bg-gray-200/50 rounded-full p-1 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            </div>
            <div className="p-6 overflow-y-auto">
               <div className="text-center mb-4">
                  <p className="text-xs text-gray-500 font-mono">BUNGAS v2.2 (Ultra Fast)</p>
                  <div className={`mt-2 inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold border ${activeKeySource === "MANUAL" ? "bg-green-100 text-green-700 border-green-200" : activeKeySource === "HARDCODE" ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                    STATUS: {activeKeySource === "MANUAL" ? "✅ MANUAL (PRIORITAS)" : activeKeySource === "HARDCODE" ? "🔵 DEFAULT/KODE" : "❌ BELUM ADA KEY"}
                  </div>
               </div>
               <div className="bg-white/60 p-5 rounded-xl border border-blue-100 mb-6 shadow-sm">
                  <label className="text-sm font-bold text-gray-700 flex items-center gap-2 mb-3">🔑 API Key Manual</label>
                  <div className="relative mb-3">
                    <input type="password" value={userApiKey} onChange={(e) => setUserApiKey(e.target.value)} placeholder="Tempel API Key disini..." className="w-full p-3 pl-4 pr-10 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-sm transition-all bg-white" />
                    {userApiKey && (<button onClick={() => setUserApiKey("")} className="absolute right-3 top-3 text-gray-400 hover:text-red-500">x</button>)}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveApiKey} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 active:scale-95 transition-all shadow-md">💾 Simpan</button>
                    <button onClick={removeApiKey} className="px-3 py-2 bg-red-100 text-red-600 rounded-lg text-sm font-bold hover:bg-red-200 active:scale-95 transition-all">Hapus</button>
                  </div>
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="block mt-3 text-xs text-center text-blue-500 underline hover:text-blue-700">Ambil API Key Baru Disini</a>
               </div>
               <div className="text-center border-t border-gray-200 pt-4">
                  <button onClick={handleInstallApp} disabled={!installPrompt} className="px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl text-sm w-full disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all font-bold active:scale-95">{installPrompt ? "📲 Install Aplikasi" : "✅ Siap Digunakan"}</button>
               </div>
            </div>
          </div>
        </div>
      )}

      {showInfo && (
        <div className="absolute inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="glass-panel bg-white/95 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col items-center text-center relative">
            <button onClick={() => setShowInfo(false)} className="absolute top-2 right-2 p-2 hover:bg-gray-100 rounded-full text-gray-600">X</button>
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 w-full p-6 text-white mb-2"><h2 className="text-xl font-bold">Tentang Pembuat</h2></div>
            <div className="p-6 pt-2"><h3 className="text-2xl font-extrabold text-gray-800 mb-1">Deni Ranoptri</h3><p className="text-xs text-blue-600 font-semibold mb-6">Guru Inovatif & Konten Kreator</p></div>
          </div>
        </div>
      )}

      {/* --- MAIN CONTENT --- */}
      <div className="flex flex-col lg:flex-row h-full w-full relative z-10 overflow-hidden">
        <div ref={containerRef} className="flex-1 w-full min-h-0 flex items-center justify-center relative lg:order-1 order-1">
          <div style={{ transform: `scale(${robotScale})` }} className="origin-center transition-transform duration-500 relative">
             <Robot state={robotState} />
             {/* VISUAL INDICATOR LUP (ANTI-KUDET) */}
             {isSearchingVisual && robotState === RobotState.THINKING && (
               <div className="absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center animate-bounce z-40">
                  <div className="bg-white/90 p-2.5 rounded-full shadow-lg border-2 border-blue-400 backdrop-blur-sm">
                    <span className="text-2xl block animate-spin-slow">🔍</span>
                  </div>
                  <div className="bg-blue-500 text-white px-2 py-0.5 rounded-full text-[0.6rem] font-bold mt-1 shadow-md whitespace-nowrap">
                    CARI WEB
                  </div>
               </div>
             )}
          </div>
        </div>

        <div className="flex-none lg:flex-1 lg:h-full w-full lg:w-auto flex flex-col justify-end lg:justify-center items-center lg:items-start p-4 lg:p-12 lg:order-2 order-2 z-20">
          <div className="w-full max-w-2xl glass-panel rounded-[2rem] p-4 sm:p-6 flex flex-col gap-4 shadow-xl transition-all duration-300">
            <div className="h-[120px] lg:h-[200px] overflow-y-auto hide-scrollbar text-center flex flex-col justify-center items-center px-2 relative mask-linear-fade">
              
              {/* --- BAGIAN PENTING: LOGIKA TAMPILAN RESPON --- */}
              
              {/* 1. TAMPILKAN LOADING / TRANSCRIPT HANYA JIKA BELUM ADA JAWABAN SAMA SEKALI */}
              {(isListening || (isThinking && !displayedResponse) || isRecharging) && (
                 <p className="text-blue-400 font-bold italic animate-pulse mb-2 text-sm lg:text-lg tracking-wide">{isRecharging ? "🔌 MENGISI DAYA..." : `"${transcript || '...'}"`}</p>
              )}

              {/* 2. TAMPILKAN JAWABAN SEGERA SETELAH ADA TEKS (STREAMING), MESKIPUN MASIH THINKING */}
              {displayedResponse && (
                 <div className="w-full">
                   <p className={`text-base sm:text-lg lg:text-xl font-medium leading-relaxed selectable-text ${isRecharging ? 'text-orange-500' : 'text-gray-700'}`}>
                     {displayedResponse}
                     {/* Kursor ketik agar terlihat seperti sedang diketik robot */}
                     {isThinking && <span className="inline-block w-2 h-5 bg-blue-400 ml-1 animate-pulse align-middle"></span>}
                   </p>
                 </div>
              )}
              
              {/* 3. TAMPILAN IDLE AWAL */}
              {robotState === RobotState.IDLE && !displayedResponse && (
                 <div className="flex flex-col items-center animate-pulse opacity-70">
                    <p className="text-blue-500 text-lg font-bold">Halo, Sahabat!</p>
                    <p className="text-gray-500 text-sm">Ada yang bisa Ulun bantu?</p>
                 </div>
              )}
            </div>

            {robotState === RobotState.IDLE && !inputValue && !selectedImage && (
              <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar w-full touch-pan-x justify-start lg:justify-center">
                {SUGGESTION_CHIPS.map((chip, idx) => (
                  <button key={idx} onClick={() => handleChipClick(chip.replace(/^[^\s]+\s/, ''))} className="whitespace-nowrap px-4 py-1.5 bg-white/60 hover:bg-white text-blue-600 rounded-full text-xs sm:text-sm font-bold border border-blue-100 transition-all shadow-sm hover:shadow-md">{chip}</button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 w-full mt-auto">
                <div className="relative flex-1 flex items-center group">
                  {selectedImage && (
                    <div className="absolute left-2 bottom-14 lg:bottom-16 glass-panel p-1 rounded-xl animate-slideUp z-20">
                      <img src={selectedImage} alt="Preview" className="w-20 h-20 object-cover rounded-lg" />
                      <button onClick={() => {setSelectedImage(null); setInputValue("");}} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 w-6 h-6 flex items-center justify-center text-xs shadow-md transform hover:scale-110 transition-transform">X</button>
                    </div>
                  )}
                  <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()} placeholder={isListening ? "Mendengarkan..." : "Ketik pertanyaan..."} disabled={isListening || isThinking || isRecharging} className="w-full pl-6 pr-24 py-4 rounded-full border border-white/60 bg-white/50 focus:bg-white/90 focus:border-blue-300 focus:outline-none focus:ring-4 focus:ring-blue-100/50 transition-all shadow-inner text-gray-700 font-semibold placeholder-gray-400 disabled:opacity-50 text-base" />
                  <div className="absolute right-2 flex gap-1">
                    <button onClick={() => fileInputRef.current?.click()} disabled={isThinking} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors">🖼️</button>
                    <button onClick={() => cameraInputRef.current?.click()} disabled={isThinking} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors">📷</button>
                  </div>
                </div>
                <button onClick={handleMainButtonClick} disabled={isThinking || isRecharging} className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white border-4 border-white/30 backdrop-blur-sm transform hover:scale-105 active:scale-95 transition-all duration-300 ${isThinking ? 'bg-gray-400 animate-pulse' : isRecharging ? 'bg-orange-400' : isTalking ? 'bg-red-500 shadow-red-200' : showSendIcon ? 'bg-blue-500' : isListening ? 'bg-red-500 animate-ping-slow' : 'bg-gradient-to-tr from-blue-500 to-indigo-600 shadow-blue-200'}`}>
                  {isThinking ? <span className="text-xl animate-bounce">●</span> : isRecharging ? "⚡" : isTalking ? <div className="w-4 h-4 bg-white rounded-sm"></div> : showSendIcon ? <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>}
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;