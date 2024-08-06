# Firebase Chat Application

This project is a real-time chat application built with Next.js, React, and Firebase. It features user authentication, real-time messaging, and streaming responses from an AI assistant.

## Features

- User authentication with Google Sign-In
- Real-time messaging using Firebase Firestore
- Streaming responses from an AI assistant (using OpenAI's GPT model)
- Responsive UI built with Material-UI

## Prerequisites

Before you begin, ensure you have met the following requirements:

- Node.js (v14 or later)
- npm or yarn
- A Firebase account and project
- An OpenAI API key

## Setup

1. Clone the repository:

   ```
   git clone https://github.com/haru235/ai-chatbot.git
   cd ai-customer-support
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Set up your Firebase project:

   - Create a new project in the [Firebase Console](https://console.firebase.google.com/)
   - Enable Google Sign-In in the Authentication section
   - Create a Firestore database

4. Set up your environment variables:
   Create a `.env.local` file in the root directory and add the following:

   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
   OPENAI_API_KEY=your_openai_api_key
   ```

5. Update Firestore security rules:
   Go to the Firebase Console, navigate to Firestore Database > Rules, and paste the rules from the `firestore.rules` file.

6. Run the development server:

   ```
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Usage

1. Sign in using your Google account
2. Start chatting! Type a message and press send
3. The AI assistant will respond in real-time

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
