'use client';

import { useState } from 'react';

export default function ContactPage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      });

      if (!res.ok) throw new Error('Failed to send');
      setStatus('sent');
      setSubject('');
      setMessage('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="max-w-xl mx-auto mt-12 p-8">
      <h2 className="text-2xl font-bold mb-6">Quick Message</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="subject" className="block text-sm font-medium mb-1">Subject</label>
          <input id="subject" type="text" value={subject} onChange={e => setSubject(e.target.value)} required className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium mb-1">Message</label>
          <textarea id="message" value={message} onChange={e => setMessage(e.target.value)} rows={4} required className="w-full border rounded px-3 py-2" />
        </div>
        <button type="submit" disabled={status === 'sending'} className="bg-black text-white px-6 py-2 rounded">
          {status === 'sending' ? 'Sending...' : 'Send'}
        </button>
        {status === 'sent' && <p className="text-green-600">Message sent!</p>}
        {status === 'error' && <p className="text-red-600">Failed to send. Try again.</p>}
      </form>
    </div>
  );
}
