"use client"; // Indicates this is a client-side component

// Import necessary modules and components
import { isValidHttpUrl } from './utils'; // Utility function to validate URLs
import {
  Box, Button, TextField, Checkbox, Select, MenuItem, CircularProgress,
  Typography, Paper, Grid, FormControlLabel, LinearProgress, Divider,
  Autocomplete,
  Modal,
  Tooltip,
  IconButton,
  Chip,
  ThemeProvider,
  createTheme
} from '@mui/material'; // MUI components for UI
import { useState, useEffect, useRef, useCallback } from "react"; // React hooks
import { initializeApp } from "firebase/app"; // Firebase initialization
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut
} from "firebase/auth"; // Firebase authentication functions
import {
  getFirestore, collection, addDoc, query, where,
  orderBy, onSnapshot, updateDoc, doc
} from "firebase/firestore"; // Firebase Firestore functions
import { Send, Add, Logout, Login, Info } from '@mui/icons-material'; // MUI conponents for Icons
import languages from '@cospired/i18n-iso-languages' // Used to get languages
import ReactMarkdown from 'react-markdown'; // For formatting response from openai

// Firebase configuration with environment variables
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Create a custom theme
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#9c27b0',
    },
    secondary: {
      main: '#7c4dff',
    },
    background: {
      default: '#121212',
      paper: '#1E1E1E',
    },
    text: {
      primary: '#ffffff',
      secondary: '#b3b3b3',
    },
  },
});

export default function Home() {
  // State variables
  const [user, setUser] = useState(null); // Stores the authenticated user
  const [messages, setMessages] = useState([{ role: "assistant", content: "Ask me anything!" }]); // Stores chat messages
  const [message, setMessage] = useState(""); // Stores current message being typed
  const [isLoading, setIsLoading] = useState(false); // Loading state for API calls
  const [newContext, setNewContext] = useState(""); // Stores new context input
  const [contextUsed, setContextUsed] = useState([]); // Stores the context used in responses
  const [isUrl, setIsUrl] = useState(false); // Determines if input is a URL
  const [addingContextProgress, setAddingContextProgress] = useState(0); // Progress of adding context
  const messagesEndRef = useRef(null); // Reference to the end of the messages list for auto-scroll
  const [useOnlyMyContext, setUseOnlyMyContext] = useState(false); // Toggle only using context added by user
  const [language, setLanguage] = useState({ code: "en", name: "English" }); // Language the chatbot will reply with
  const [infoOpen, setInfoOpen] = useState(false); // Toggle info

  // Effect to monitor authentication state changes
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
      if (user) loadMessages(user.uid); // Load messages if user is signed in
      else setMessages([]); // Clear messages if user is signed out
    });
    return () => unsubscribe();
  }, []);

  // Effect to auto-scroll to the latest message
  useEffect(() => {
    if (messagesEndRef.current) {
      setTimeout(() => {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    }
  }, [messages]);

  // Function to load messages from Firestore
  const loadMessages = useCallback((userId) => {
    const q = query(
      collection(db, "messages"),
      where("userId", "==", userId),
      orderBy("timestamp", "asc")
    );

    return onSnapshot(q, (querySnapshot) => {
      const loadedMessages = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMessages([{ role: "assistant", content: "Ask me anything!" }, ...loadedMessages]);
    });
  }, []);

  // Function to handle Google sign-in
  const signIn = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error("Error signing in:", error);
    }
  };

  // Function to handle sign-out
  const signOutUser = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Function to handle adding context or URL
  const handleAddContext = async () => {
    setIsLoading(true);
    setAddingContextProgress(0);

    try {
      if (!newContext) {
        throw new Error("Context or URL must be provided");
      }

      if (isUrl && !isValidHttpUrl(newContext)) {
        throw new Error("Invalid URL provided");
      }

      const response = await fetch("/api/addContext", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: newContext,
          isUrl: isUrl,
          userName: user.displayName,
          userId: user.uid,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.percentage !== undefined) {
              setAddingContextProgress(data.percentage);
            } else if (data.error) {
              throw new Error(data.error);
            }
          } catch (error) {
            console.error("Error parsing chunk:", error);
          }
        }
      }

      setNewContext("");
      setIsUrl(false);
    } catch (error) {
      console.error("Error adding context:", error);
      alert(`Failed to add context: ${error.message}`);
    } finally {
      setIsLoading(false);
      setAddingContextProgress(0);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevents newline if Shift+Enter is not pressed
      handleSendMessage();
    }
  };

  // Function to handle sending a message
  const handleSendMessage = async () => {
    if (!user || !message.trim()) return;

    setIsLoading(true);

    try {
      const userMessage = {
        userId: user.uid,
        content: message,
        role: "user",
        timestamp: new Date(),
      };

      await addDoc(collection(db, "messages"), userMessage);
      setMessage("");

      const assistantMessageRef = await addDoc(collection(db, "messages"), {
        userId: user.uid,
        content: "",
        role: "assistant",
        timestamp: new Date(),
      });

      const requestPayload = {
        messages: [...messages, userMessage].map(({ role, content }) => ({ role, content })),
        query: message,
        useOnlyMyContext: useOnlyMyContext,
        userId: user.uid,
        language: language ? language.name : "English",
      };

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const messages = chunk.split('\n').filter(Boolean);

        for (const message of messages) {
          try {
            const data = JSON.parse(message);
            if (data.type === 'context') {
              setContextUsed(data.documents)
            } else if (data.type === 'content') {
              assistantResponse += data.content;
              await updateDoc(doc(db, "messages", assistantMessageRef.id), {
                content: assistantResponse,
              });
            }
          } catch (error) {
            console.error("Error parsing message:", error);
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      alert(`Failed to send message: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  languages.registerLocale(require('@cospired/i18n-iso-languages/langs/en.json'));

  const allLanguages = Object.entries(languages.getNames('en')).map(([code, name]) => ({
    code, name,
  }));

  return (
    <ThemeProvider theme={darkTheme}>
      <Box sx={{
        display: 'flex',
        height: '100vh',
        bgcolor: 'background.default',
        p: 3,
        background: 'linear-gradient(45deg, #121212 30%, #1a237e 90%)',
        boxShadow: 'inset 0 0 100px rgba(156, 39, 176, 0.3)'  // Purple ambient lighting
      }}>
        <Paper elevation={3} sx={{
          m: 'auto',
          width: '100%',
          maxWidth: '1200px',
          overflow: 'hidden',
          bgcolor: 'rgba(30, 30, 30, 0.8)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '15px',
        }}>
          <Grid container>
            <Grid item xs={12} sx={{ p: 2, borderBottom: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box display="flex" flexDirection="row" alignItems="center">
                  <Typography variant="h5" component="h1" sx={{ color: '#b388ff' }}>ConvoCraft</Typography>
                  <Tooltip title="How to use">
                    <IconButton onClick={() => setInfoOpen(true)} color="secondary">
                      <Info />
                    </IconButton>
                  </Tooltip>
                </Box>
                {user && (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Chip label={"Hello, " + user.displayName} sx={{ mr: 2, bgcolor: 'rgba(156, 39, 176, 0.2)' }} />
                    <Button
                      variant="outlined"
                      onClick={signOutUser}
                      startIcon={<Logout />}
                      sx={{ borderColor: '#b388ff', color: '#b388ff' }}
                    >
                      Sign Out
                    </Button>
                  </Box>
                )}
              </Box>
            </Grid>
            {!user ? (
              <Grid item xs={12} sx={{
                p: 3,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '80vh',
                background: 'linear-gradient(135deg, rgba(156, 39, 176, 0.1) 0%, rgba(124, 77, 255, 0.1) 100%)',
              }}>
                <Typography variant="h6" gutterBottom sx={{ color: '#b388ff' }}>Welcome to ConvoCraft</Typography>
                <Typography variant="body1" gutterBottom sx={{ textAlign: 'center', maxWidth: '600px', mb: 3, color: '#e1bee7' }}>
                  Sign in to start training your chatbot, manage context, and engage in conversations.
                </Typography>
                <Button
                  variant="contained"
                  onClick={signIn}
                  startIcon={<Login />}
                  size="large"
                  sx={{
                    bgcolor: '#7c4dff',
                    '&:hover': {
                      bgcolor: '#651fff',
                    }
                  }}
                >
                  Sign In with Google
                </Button>
              </Grid>
            ) : (
              <>
                <Grid item xs={12} md={7} sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 'calc(80vh - 64px)' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Autocomplete
                      options={Object.entries(languages.getNames('en')).map(([code, name]) => ({ code, name }))}
                      getOptionLabel={(option) => option.name}
                      value={language}
                      onChange={(_, newValue) => setLanguage(newValue)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Select Language"
                          variant="outlined"
                          sx={{
                            width: 200,
                            '& .MuiOutlinedInput-root': {
                              '& fieldset': {
                                borderColor: 'rgba(179, 136, 255, 0.5)',
                              },
                              '&:hover fieldset': {
                                borderColor: '#b388ff',
                              },
                            },
                          }}
                        />
                      )}
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={useOnlyMyContext}
                          onChange={(e) => setUseOnlyMyContext(e.target.checked)}
                          sx={{
                            color: '#b388ff',
                            '&.Mui-checked': {
                              color: '#7c4dff',
                            },
                          }}
                        />
                      }
                      label="Only use my context"
                    />
                  </Box>
                  <Box sx={{ flexGrow: 1, overflowY: 'auto', mb: 2, bgcolor: 'rgba(30, 30, 30, 0.6)', p: 2, borderRadius: 2 }}>
                    {messages.map((msg, index) => (
                      <Box
                        key={index}
                        sx={{
                          display: 'flex',
                          justifyContent: msg.role === 'assistant' ? 'flex-start' : 'flex-end',
                          mb: 1
                        }}
                      >
                        <Paper
                          elevation={1}
                          sx={{
                            p: 1,
                            maxWidth: '80%',
                            bgcolor: msg.role === 'assistant' ? 'rgba(156, 39, 176, 0.2)' : 'rgba(124, 77, 255, 0.2)',
                            borderRadius: '10px',
                          }}
                        >
                          <ReactMarkdown components={{
                            ol: ({ children }) => (
                              <ol style={{ paddingLeft: '2rem', paddingTop: '1rem', paddingBottom: '.5rem'}}>
                                {children}
                              </ol>
                            ),
                            ul: ({ children }) => (
                              <ul style={{ paddingLeft: '2rem', paddingTop: '1rem', paddingBottom: '.5rem'}}>
                                {children}
                              </ul>
                            ),
                            li: ({ children }) => (
                              <li style={{ marginBottom: '0.5rem' }}>
                                {children}
                              </li>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote style={{ borderLeft: '4px solid #ddd', paddingLeft: '2rem', paddingTop: '1rem', paddingBottom: '1rem', color: '#aaa' }}>
                                {children}
                              </blockquote>
                            ),
                            code: ({ inline, children }) => (
                              inline ? (
                                <code style={{ backgroundColor: '#f5f5f5', padding: '2px 4px', borderRadius: '4px' }}>
                                  {children}
                                </code>
                              ) : (
                                <pre style={{ backgroundColor: '#333', padding: '1rem', borderRadius: '4px', color: '#f5f5f5' }}>
                                  <code>
                                    {children}
                                  </code>
                                </pre>
                              )
                            ),
                            a: ({ href, children }) => (
                              <a href={href} style={{ color: '#61dafb', textDecoration: 'none' }}>
                                {children}
                              </a>
                            ),
                            img: ({ alt, src }) => (
                              <img alt={alt} src={src} style={{ maxWidth: '100%', borderRadius: '4px' }} />
                            ),
                            table: ({ children }) => (
                              <div style={{ overflowX: 'auto', width: '100%' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  {children}
                                </table>
                              </div>
                            ),
                            th: ({ children }) => (
                              <th style={{ border: '1px solid #ddd', padding: '0.5rem', textAlign: 'left', backgroundColor: '#f5f5f5' }}>
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td style={{ border: '1px solid #ddd', padding: '0.5rem', wordWrap: 'break-word' }}>
                                {children}
                              </td>
                            ),
                          }}>{msg.content}</ReactMarkdown>
                        </Paper>
                      </Box>
                    ))}
                    <div ref={messagesEndRef} />
                  </Box>
                  <Box sx={{ display: 'flex' }}>
                    <TextField
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Type your message..."
                      fullWidth
                      variant="outlined"
                      disabled={isLoading}
                      onKeyDown={handleKeyDown}
                      sx={{
                        mr: 1,
                        '& .MuiOutlinedInput-root': {
                          '& fieldset': {
                            borderColor: 'rgba(179, 136, 255, 0.5)',
                          },
                          '&:hover fieldset': {
                            borderColor: '#b388ff',
                          },
                        },
                      }}
                    />
                    <Button
                      variant="contained"
                      onClick={handleSendMessage}
                      disabled={isLoading}
                      sx={{
                        minWidth: 0,
                        width: 56,
                        height: 56,
                        bgcolor: '#7c4dff',
                        '&:hover': {
                          bgcolor: '#651fff',
                        }
                      }}
                    >
                      {isLoading ? <CircularProgress size={24} /> : <Send />}
                    </Button>
                  </Box>
                </Grid>
                <Grid item xs={12} md={5} sx={{
                  bgcolor: 'rgba(30, 30, 30, 0.6)',
                  p: 3,
                  display: 'flex',
                  flexDirection: 'column',
                  height: 'calc(80vh - 64px)',
                  borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={isUrl}
                        onChange={(e) => {
                          setIsUrl(e.target.checked);
                          setNewContext('');
                        }}
                        sx={{
                          color: '#b388ff',
                          '&.Mui-checked': {
                            color: '#7c4dff',
                          },
                        }}
                      />
                    }
                    label="Add Website"
                    sx={{ mb: 2 }}
                  />
                  <TextField
                    label={isUrl ? "Enter URL" : "Enter Context"}
                    value={newContext}
                    onChange={(e) => setNewContext(e.target.value)}
                    multiline={!isUrl}
                    rows={isUrl ? 1 : 4}
                    fullWidth
                    variant="outlined"
                    sx={{
                      mb: 2,
                      '& .MuiOutlinedInput-root': {
                        '& fieldset': {
                          borderColor: 'rgba(179, 136, 255, 0.5)',
                        },
                        '&:hover fieldset': {
                          borderColor: '#b388ff',
                        },
                      },
                    }}
                  />
                  <Button
                    variant="contained"
                    onClick={handleAddContext}
                    disabled={isLoading}
                    startIcon={<Add />}
                    sx={{
                      mb: 2,
                      bgcolor: '#7c4dff',
                      '&:hover': {
                        bgcolor: '#651fff',
                      }
                    }}
                  >
                    {isLoading ? 'Adding...' : 'Add Context'}
                  </Button>
                  {addingContextProgress > 0 && (
                    <LinearProgress
                      variant="determinate"
                      value={addingContextProgress}
                      sx={{
                        mb: 2,
                        height: 8,
                        borderRadius: 4,
                        bgcolor: 'rgba(124, 77, 255, 0.2)',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: '#7c4dff',
                        }
                      }}
                    />
                  )}
                  <Divider sx={{ mb: 2, bgcolor: 'rgba(255, 255, 255, 0.1)' }} />
                  <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
                    <Typography variant="subtitle1" gutterBottom sx={{ color: '#b388ff' }}>
                      {contextUsed.length > 0 ? `${contextUsed.length} Documents Matched:` : 'No Matched Documents'}
                    </Typography>
                    {contextUsed.map((context, index) => (
                      <Paper key={index} elevation={1} sx={{
                        p: 2,
                        mb: 2,
                        bgcolor: 'rgba(124, 77, 255, 0.1)',
                        borderRadius: '10px',
                      }}>
                        <Typography variant="subtitle2" sx={{ color: '#e1bee7' }}>Source: {context.metadata?.source} ({Math.round(context.similarity * 100)}% Match)</Typography>
                        <Typography variant="body2" sx={{ mt: 1 }}>&quot;{context.content}&quot;</Typography>
                      </Paper>
                    ))}
                  </Box>
                </Grid>
              </>
            )}
          </Grid>
        </Paper>

        <Modal
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          aria-labelledby="info-modal-title"
          aria-describedby="info-modal-description"
        >
          <Box sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 400,
            bgcolor: 'rgba(30, 30, 30, 0.9)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
            p: 4,
            borderRadius: 2,
            border: '1px solid rgba(255, 255, 255, 0.18)',
          }}>
            <Typography id="info-modal-title" variant="h6" component="h2" gutterBottom sx={{ color: '#b388ff' }}>
              How to Use This Chatbot
            </Typography>
            <Typography id="info-modal-description" sx={{ mt: 2, color: '#e1bee7' }}>
              1. Select your preferred language from the dropdown menu.<br />
              2. Type your message in the text field at the bottom and click the send button.<br />
              3. To add context, use the right panel. You can add text directly or provide a URL.<br />
              4. Check &quot;Only use my context&quot; if you want the chatbot to use only your provided context.<br />
              5. View matched documents in the right panel after sending a message.
            </Typography>
            <Button onClick={() => setInfoOpen(false)} sx={{ mt: 2, color: '#b388ff' }}>Close</Button>
          </Box>
        </Modal>
      </Box>
    </ThemeProvider>
  );
}