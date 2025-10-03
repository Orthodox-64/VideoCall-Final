import * as React from "react";
import { ZegoUIKitPrebuilt } from "@zegocloud/zego-uikit-prebuilt";
import { ZIM } from "zego-zim-web";

function randomID(len = 5) {
  let result = "";
  const chars =
    "12345qwertyuiopasdfgh67890jklmnbvcxzMNBVCZXASDQWERTYHGFUIOLKJP";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function getUrlParams(url = window.location.href) {
  const urlStr = url.split("?")[1];
  return new URLSearchParams(urlStr);
}

export default function App() {
  const [captions, setCaptions] = React.useState([]);
  const [targetLanguage, setTargetLanguage] = React.useState("hi-IN");
  const [isListening, setIsListening] = React.useState(false);
  const [recognitionSupported, setRecognitionSupported] = React.useState(true);
  const [uploadedFiles, setUploadedFiles] = React.useState([]);
  const captionsEndRef = React.useRef(null);
  const recognitionRef = React.useRef(null);
  const zpInstanceRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const roomID = getUrlParams().get("roomID") || randomID(5);

  // Auto-scroll to bottom when new captions arrive
  React.useEffect(() => {
    captionsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [captions]);

  const addCaption = (username, translated) => {
    const timestamp = new Date().toLocaleTimeString();
    setCaptions(prev => [...prev, { timestamp, username, translated }]);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const fileData = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: e.target.result,
        timestamp: new Date().toISOString()
      };

      // Add to local state
      setUploadedFiles(prev => [...prev, fileData]);

      // Send to all participants using ZIM custom command
      if (zpInstanceRef.current) {
        const message = {
          type: 'file',
          fileData: fileData
        };
        
        try {
          await zpInstanceRef.current.sendInRoomCustomCommand(message);
          console.log("File sent successfully:", fileData.name);
        } catch (error) {
          console.error("Error sending file:", error);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      addCaption("System", "Speech Recognition not supported. Please use Chrome or Edge browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      console.log("Speech recognition started");
      setIsListening(true);
    };

    recognition.onresult = async (event) => {
      const current = event.resultIndex;
      const transcript = event.results[current][0].transcript;

      if (event.results[current].isFinal) {
        console.log("Final transcript:", transcript);
        
        try {
          const translation = await translateText(transcript, targetLanguage);
          
          // Send translation to all participants via ZegoCloud ZIM
          if (zpInstanceRef.current) {
            const message = {
              type: 'translation',
              original: transcript,
              translated: translation,
              language: targetLanguage,
              timestamp: new Date().toISOString()
            };
            
            try {
              await zpInstanceRef.current.sendInRoomCustomCommand(message);
              console.log("Translation sent:", translation);
              // Also add to local captions
              addCaption("You", translation);
            } catch (error) {
              console.error("Error sending message:", error);
              // Still show locally even if send fails
              addCaption("You", translation);
            }
          }
        } catch (error) {
          console.error("Translation error:", error);
        }
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === 'not-allowed') {
        addCaption("System", "Microphone access denied. Please allow microphone permissions");
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      console.log("Speech recognition ended");
      if (isListening && recognitionRef.current) {
        setTimeout(() => {
          try {
            recognition.start();
          } catch (e) {
            console.log("Could not restart recognition");
          }
        }, 100);
      }
    };

    try {
      recognition.start();
    } catch (error) {
      console.error("Error starting recognition:", error);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      setIsListening(false);
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const myMeeting = async (element) => {
    if (!element) return;

    const appID = 82721077;
    const serverSecret = "6250ee6a210c4e8a2847932ebe295ca7";

    const userID = randomID(8);
    const userName = "User-" + userID;

    const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
      appID,
      serverSecret,
      roomID,
      userID,
      userName
    );
    const zp = ZegoUIKitPrebuilt.create(kitToken);
    
    // Add ZIM plugin for custom messaging
    zp.addPlugins({ ZIM });
    
    zpInstanceRef.current = zp;

    const meetingURL = `${window.location.protocol}//${window.location.hostname}:${window.location.port}${window.location.pathname}?roomID=${roomID}`;

    try {
      await zp.joinRoom({
        container: element,
        sharedLinks: [{ name: "Personal link", url: meetingURL }],
        scenario: { mode: ZegoUIKitPrebuilt.GroupCall },
        voiceEffect: { noiseSuppression: true },
        showPreJoinView: false,
        turnOnCameraWhenJoining: true,
        turnOnMicrophoneWhenJoining: true,
        onInRoomCustomCommandReceived: (messages) => {
          // Handle incoming custom command messages from other participants
          console.log("Received custom commands:", messages);
          messages.forEach(msg => {
            try {
              // The message might be a string or object
              const data = typeof msg.msg === 'string' ? JSON.parse(msg.msg) : msg.msg;
              console.log("Parsed message data:", data);
              
              if (data.type === 'translation') {
                addCaption(msg.fromUser?.userName || "Other User", data.translated);
              } else if (data.type === 'file') {
                console.log("Received file:", data.fileData.name);
                setUploadedFiles(prev => {
                  // Check if file already exists to avoid duplicates
                  const exists = prev.some(f => f.timestamp === data.fileData.timestamp);
                  if (!exists) {
                    return [...prev, data.fileData];
                  }
                  return prev;
                });
              }
            } catch (e) {
              console.log("Error parsing message:", e, msg);
            }
          });
        }
      });

      console.log("Successfully joined room with ZIM enabled");
    } catch (error) {
      console.error("Failed to join the room:", error);
    }
  };

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh" }}>
      {/* Video call container */}
      <div style={{ flex: 1, position: "relative" }}>
        <div ref={myMeeting} style={{ width: "100%", height: "100%" }}></div>
      </div>

      {/* Translation sidebar */}
      <div
        style={{
          width: "400px",
          backgroundColor: "#1a1a1a",
          color: "white",
          display: "flex",
          flexDirection: "column",
          borderLeft: "2px solid #333",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px",
            backgroundColor: "#252525",
            borderBottom: "2px solid #333",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "15px" }}>
            <h2 style={{ margin: 0, fontSize: "20px" }}>
              Live Translation
            </h2>
            {isListening && (
              <div style={{
                width: "8px",
                height: "8px",
                backgroundColor: "#ff4444",
                borderRadius: "50%",
                animation: "pulse 1.5s ease-in-out infinite"
              }} />
            )}
          </div>
          
          <div style={{ marginBottom: "15px" }}>
            <label style={{ fontSize: "14px", marginRight: "10px" }}>
              Translate to:
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              disabled={isListening}
              style={{
                padding: "5px 10px",
                borderRadius: "4px",
                border: "1px solid #444",
                backgroundColor: isListening ? "#222" : "#333",
                color: isListening ? "#666" : "white",
                fontSize: "14px",
                cursor: isListening ? "not-allowed" : "pointer"
              }}
            >
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">Hindi</option>
              <option value="pa-IN">Punjabi</option>
              <option value="te-IN">Telugu</option>
              <option value="ta-IN">Tamil</option>
              <option value="mr-IN">Marathi</option>
              <option value="kn-IN">Kannada</option>
              <option value="ml-IN">Malayalam</option>
              <option value="bn-IN">Bengali</option>
              <option value="gu-IN">Gujarati</option>
              <option value="or-IN">Odia</option>
              <option value="as-IN">Assamese</option>
              <option value="ur-IN">Urdu</option>
              <option value="ks-IN">Kashmiri</option>
              <option value="kok-IN">Konkani</option>
              <option value="mai-IN">Maithili</option>
              <option value="sd-IN">Sindhi</option>
              <option value="sa-IN">Sanskrit</option>
              <option value="mni-IN">Manipuri (Meitei)</option>
              <option value="ne-IN">Nepali</option>
              <option value="bho-IN">Bhojpuri</option>
              <option value="sat-IN">Santali</option>
              <option value="dog-IN">Dogri</option>
            </select>
          </div>

          {/* Control Button */}
          <button
            onClick={isListening ? stopListening : startListening}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: isListening ? "#ff4444" : "#4a9eff",
              color: "white",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.3s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              marginBottom: "10px"
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = isListening ? "#ff2222" : "#3a8eef";
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = isListening ? "#ff4444" : "#4a9eff";
            }}
          >
            {isListening ? (
              <>
                <span style={{ fontSize: "18px" }}>⏹</span>
                Stop Listening
              </>
            ) : (
              <>
                <span style={{ fontSize: "18px" }}>🎤</span>
                Start Listening
              </>
            )}
          </button>

          {/* File Upload Button */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileUpload}
            style={{ display: "none" }}
            accept="*/*"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "6px",
              border: "2px dashed #4a9eff",
              backgroundColor: "transparent",
              color: "#4a9eff",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.3s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px"
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = "#4a9eff22";
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = "transparent";
            }}
          >
            <span style={{ fontSize: "20px" }}>+</span>
            Upload File
          </button>

          {!recognitionSupported && (
            <div style={{
              marginTop: "10px",
              padding: "8px",
              backgroundColor: "#ff444433",
              borderRadius: "4px",
              fontSize: "12px",
              color: "#ffaaaa"
            }}>
              ⚠ Speech recognition not supported. Use Chrome or Edge.
            </div>
          )}
        </div>

        {/* Captions and Files list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
          }}
        >
          {/* Uploaded Files */}
          {uploadedFiles.map((file, idx) => (
            <div
              key={`file-${idx}`}
              style={{
                marginBottom: "15px",
                padding: "12px",
                backgroundColor: "#2a2a2a",
                borderRadius: "8px",
                borderLeft: "3px solid #44ff88",
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "10px"
              }}>
                <span style={{ fontSize: "24px" }}>📎</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", color: "#fff", marginBottom: "4px" }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: "11px", color: "#888" }}>
                    {(file.size / 1024).toFixed(2)} KB
                  </div>
                </div>
                <a
                  href={file.data}
                  download={file.name}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#44ff88",
                    color: "#000",
                    borderRadius: "4px",
                    fontSize: "12px",
                    textDecoration: "none",
                    fontWeight: "600"
                  }}
                >
                  Download
                </a>
              </div>
            </div>
          ))}

          {/* Captions */}
          {captions.length === 0 && uploadedFiles.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "#666",
                marginTop: "50px",
                fontSize: "14px",
              }}
            >
              {isListening ? "Listening for speech..." : "Click 'Start Listening' to begin"}
            </div>
          ) : (
            captions.map((caption, idx) => (
              <div
                key={`caption-${idx}`}
                style={{
                  marginBottom: "20px",
                  padding: "12px",
                  backgroundColor: "#252525",
                  borderRadius: "8px",
                  borderLeft: "3px solid #4a9eff",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: "#888",
                    marginBottom: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <span>{caption.timestamp}</span>
                  <span style={{ 
                    backgroundColor: "#4a9eff33",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    color: "#4a9eff"
                  }}>
                    {caption.username}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "15px",
                    color: "#fff",
                    lineHeight: "1.5"
                  }}
                >
                  {caption.translated}
                </div>
              </div>
            ))
          )}
          <div ref={captionsEndRef} />
        </div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// Translation function using MyMemory API (free, no key needed)
async function translateText(text, targetLang) {
  try {
    const langCode = targetLang.split('-')[0];
    
    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${langCode}`
    );
    
    const data = await response.json();
    
    if (data.responseStatus === 200 && data.responseData) {
      return data.responseData.translatedText;
    }
    
    return "Translation unavailable";
  } catch (error) {
    console.error("Translation error:", error);
    return "Translation error";
  }
}
