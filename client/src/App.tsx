import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { ScrollArea } from './components/ui/scroll-area';
import { Send } from 'lucide-react';

// Types and Interfaces
type ConnectionStatus = 'connected' | 'disconnected' | 'error';

interface ChatMessage {
  type: 'system' | 'message';
  content: string;
}

interface WebSocketMessage {
  type: 'message' | 'welcome' | 'error';
  content?: string;
  message?: string;
}

const ChatApp: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = (): void => {
    wsRef.current = new WebSocket('ws://localhost:8080');

    wsRef.current.onopen = () => {
      setStatus('connected');
    };

    wsRef.current.onmessage = (event: MessageEvent) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data);
        if (data.type === 'welcome') {
          setMessages(prev => [...prev, { 
            type: 'system', 
            content: data.message || 'Welcome to the chat'
          }]);
        } else if (data.type === 'message') {
          setMessages(prev => [...prev, { 
            type: 'message', 
            content: data.content || ''
          }]);
        }
      } catch (error: any) {
        setMessages(prev => [...prev, { 
          type: 'message', 
          content: event.data 
        }]);
      }
    };

    wsRef.current.onclose = () => {
      setStatus('disconnected');
      setTimeout(connectWebSocket, 5000);
    };

    wsRef.current.onerror = (error: Event) => {
      console.error('WebSocket error:', error);
      setStatus('error');
    };
  };

  const sendMessage = (e: React.FormEvent): void => {
    e.preventDefault();
    if (inputMessage.trim() && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(inputMessage);
      setInputMessage('');
    }
  };

  const getStatusColor = (status: ConnectionStatus): string => {
    switch (status) {
      case 'connected':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-yellow-500';
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto h-[600px] flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Live Chat</span>
          <span className={`px-2 py-1 text-sm rounded-full ${getStatusColor(status)} text-white`}>
            {status}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <ScrollArea className="flex-1 mb-4">
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg ${
                  msg.type === 'system' 
                    ? 'bg-gray-100 text-gray-700'
                    : 'bg-blue-100 text-blue-900'
                }`}
              >
                {msg.content}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
        
        <form onSubmit={sendMessage} className="flex gap-2">
          <Input
            value={inputMessage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
              setInputMessage(e.target.value)
            }
            placeholder="Type your message..."
            className="flex-1"
          />
          <Button 
            type="submit" 
            disabled={status !== 'connected'}
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default ChatApp;