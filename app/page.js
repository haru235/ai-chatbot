"use client"; // Indicates this is a client-side component

// Import necessary modules and components
import { isValidHttpUrl } from './utils'; // Utility function to validate URLs
import { 
  Box, Button, Stack, TextField, CircularProgress, Typography, 
  FormControlLabel, Checkbox, LinearProgress 
} from "@mui/material"; // MUI components for UI
import { useState, useEffect, useRef, useCallback } from "react"; // React hooks
import { initializeApp } from "firebase/app"; // Firebase initialization
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, signOut 
} from "firebase/auth"; // Firebase authentication functions
import { 
  getFirestore, collection, addDoc, query, where, 
  orderBy, onSnapshot, updateDoc, doc 
} from "firebase/firestore"; // Firebase Firestore functions

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  // Function to handle sending a message
  const sendMessage = async () => {
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

  return (
    <Box
      sx={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        bgcolor: "background.default",
      }}
    >
      <Stack
        direction="column"
        sx={{
          width: "500px",
          height: "700px",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          p: 2,
          spacing: 3,
          bgcolor: "background.paper",
        }}
      >
        {user ? (
          <>
            <Button variant="outlined" onClick={signOutUser}>
              Sign Out
            </Button>
            <FormControlLabel
              control={
                <Checkbox
                  checked={useOnlyMyContext}
                  onChange={(e) => setUseOnlyMyContext(e.target.checked)}
                />
              }
              label="Only use my context"
            />
            <Stack
              direction="column"
              spacing={2}
              sx={{
                flexGrow: 1,
                overflow: "auto",
                maxHeight: "100%",
              }}
            >
              {messages.map((message, index) => (
                <Box
                  key={index}
                  sx={{
                    display: "flex",
                    justifyContent: message.role === "assistant" ? "flex-start" : "flex-end",
                  }}
                >
                  <Box
                    sx={{
                      bgcolor: message.role === "assistant" ? "primary.main" : "secondary.main",
                      color: "white",
                      borderRadius: 4,
                      padding: 2,
                      maxWidth: "80%",
                    }}
                  >
                    <Typography>{message.content}</Typography>
                  </Box>
                </Box>
              ))}
              <div ref={messagesEndRef} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Message"
                fullWidth
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isLoading}
              />
              <Button
                variant="contained"
                onClick={sendMessage}
                disabled={isLoading}
              >
                {isLoading ? <CircularProgress size={24} /> : "Send"}
              </Button>
            </Stack>
          </>
        ) : (
          <Button variant="contained" onClick={signIn}>
            Sign In with Google
          </Button>
        )}
      </Stack>
      <Stack
        direction="column"
        sx={{
          width: "500px",
          height: "700px",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          p: 2,
          spacing: 3,
          bgcolor: "background.paper",
        }}
      >
        {user ? (
          <>
            <FormControlLabel
              control={
                <Checkbox
                  checked={isUrl}
                  onChange={(e) => {
                    setIsUrl(e.target.checked);
                    setNewContext("");
                  }}
                />
              }
              label="Add Website"
            />
            {isUrl ? (
              <TextField
                label="Enter URL"
                value={newContext}
                onChange={(e) => setNewContext(e.target.value)}
                fullWidth
                margin="normal"
              />
            ) : (
              <TextField
                label="Enter Context"
                value={newContext}
                onChange={(e) => setNewContext(e.target.value)}
                multiline
                rows={4}
                fullWidth
                margin="normal"
              />
            )}
            <Button
              variant="contained"
              color="primary"
              onClick={handleAddContext}
              disabled={isLoading}
            >
              {isLoading ? 'Adding...' : 'Add Context'}
            </Button>
            {addingContextProgress > 0 && (
              <Box sx={{ width: '100%', mt: 2 }}>
                <LinearProgress variant="determinate" value={addingContextProgress} />
              </Box>
            )}
            <Stack
              direction="column"
              spacing={2}
              sx={{
                flexGrow: 1,
                overflow: "auto",
                maxHeight: "100%",
              }}
            >
              {contextUsed.length > 0 && <Typography>{contextUsed.length} Documents Matched:</Typography>}
              {contextUsed.map((context, index) => (
                <Box key={index} sx={{ borderRadius: 1, bgcolor: "action.hover", p: 2 }}>
                  <Typography variant="subtitle2">Source: {context.metadata?.source}</Typography>
                  <Typography variant="subtitle2">Match: {Math.round(context.similarity * 100)}%</Typography>
                  <Typography variant="body2">"{context.content}"</Typography>
                </Box>
              ))}
            </Stack>
          </>
        ) : (
          <Typography>Please sign in</Typography>
        )}
      </Stack>
    </Box>
  );
}