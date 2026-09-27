// Host service for Voice Input plugin (dsh-voice-input)
export const inject = ['webServer'];

export function apply(ctx, config) {
  const currentConfig = {
    url: (config?.url || '').replace(/\/+$/, ''),
    apiKey: config?.apiKey || '',
    model: config?.model || 'gemini-3.8-flash-high'
  };

  const parseJsonBody = (req) => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Audio payload exceeds 50MB limit'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload: ' + err.message));
      }
    });
    req.on('error', reject);
  });

  const sendJson = (res, statusCode, data) => {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(json);
  };

  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: '/api/voice-input',
      handler: async (req, res) => {
        try {
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const pathname = urlObj.pathname;

          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            });
            res.end();
            return;
          }

          // Configuration endpoints
          if (pathname === '/api/voice-input/config' || pathname === '/api/voice-recorder/config') {
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, config: currentConfig });
              return;
            }
            if (req.method === 'POST') {
              const body = await parseJsonBody(req);
              if (body.url !== undefined) currentConfig.url = String(body.url).trim().replace(/\/+$/, '');
              if (body.apiKey !== undefined) currentConfig.apiKey = String(body.apiKey).trim();
              if (body.model !== undefined) currentConfig.model = String(body.model).trim();
              sendJson(res, 200, { ok: true, config: currentConfig });
              return;
            }
          }

          // Audio Transcription endpoint
          if ((pathname === '/api/voice-input/transcribe' || pathname === '/api/voice-recorder/transcribe') && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { audioBase64, format = 'wav' } = body;

            if (!audioBase64) {
              sendJson(res, 400, { ok: false, error: 'audioBase64 is required' });
              return;
            }

            const targetUrl = (body.url || currentConfig.url || '').replace(/\/+$/, '');
            const apiKey = body.apiKey || currentConfig.apiKey || '';
            const model = body.model || currentConfig.model || 'gemini-3.8-flash-high';

            if (!targetUrl) {
              sendJson(res, 400, {
                ok: false,
                error: 'Provider API URL is not set. Please click the ⚙ (gear) icon to configure your Custom Provider URL.'
              });
              return;
            }

            if (!apiKey) {
              sendJson(res, 400, {
                ok: false,
                error: 'API Key is not set. Please click the ⚙ (gear) icon to enter your API Key.'
              });
              return;
            }

            const audioBuffer = Buffer.from(audioBase64, 'base64');
            let transcribedText = '';
            const errors = [];
            const systemPrompt = "You are an expert transcriber and translator. Translate or transcribe the exact meaning of the audio into clean English. Remove any spoken filler words, stutters, repetitions, and hesitation marks (like 'um', 'uh', 'you know'). Do NOT add any summaries, conversational responses, or formatting. Output ONLY the raw, clean translated text.";

            // Attempt 1: Chat Completions with input_audio (for Gemini and OpenAI multimodal LLMs)
            try {
              const chatPayload = {
                model: model,
                messages: [
                  {
                    role: 'system',
                    content: systemPrompt
                  },
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: systemPrompt
                      },
                      {
                        type: 'input_audio',
                        input_audio: {
                          data: audioBase64,
                          format: format === 'webm' ? 'wav' : (format || 'wav')
                        }
                      }
                    ]
                  }
                ],
                temperature: 0.1
              };

              const response = await fetch(`${targetUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(chatPayload),
                signal: AbortSignal.timeout(60000)
              });

              if (response.ok) {
                const data = await response.json();
                const content = data.choices?.[0]?.message?.content;
                if (content && typeof content === 'string' && content.trim()) {
                  transcribedText = content.trim();
                }
              } else {
                const errText = await response.text();
                errors.push(`chat/completions input_audio (HTTP ${response.status}): ${errText.slice(0, 300)}`);
              }
            } catch (err) {
              errors.push(`chat/completions input_audio error: ${err.message}`);
            }

            // Attempt 2: Standard OpenAI Audio Transcriptions API (Whisper endpoints)
            if (!transcribedText) {
              try {
                const formData = new FormData();
                const mimeType = format === 'webm' ? 'audio/webm' : 'audio/wav';
                const audioBlob = new Blob([audioBuffer], { type: mimeType });
                formData.append('file', audioBlob, `audio.${format || 'wav'}`);
                formData.append('model', model);

                const response = await fetch(`${targetUrl}/audio/transcriptions`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`
                  },
                  body: formData,
                  signal: AbortSignal.timeout(60000)
                });

                if (response.ok) {
                  const data = await response.json();
                  if (data && typeof data.text === 'string' && data.text.trim()) {
                    transcribedText = data.text.trim();
                  }
                } else {
                  const errText = await response.text();
                  errors.push(`audio/transcriptions (HTTP ${response.status}): ${errText.slice(0, 300)}`);
                }
              } catch (err) {
                errors.push(`audio/transcriptions request error: ${err.message}`);
              }
            }

            // Attempt 3: Chat Completions with data URI in image_url (fallback format for some proxy servers)
            if (!transcribedText) {
              try {
                const mimeType = format === 'webm' ? 'audio/webm' : 'audio/wav';
                const chatPayload = {
                  model: model,
                  messages: [
                    {
                      role: 'system',
                      content: systemPrompt
                    },
                    {
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: systemPrompt
                        },
                        {
                          type: 'image_url',
                          image_url: {
                            url: `data:${mimeType};base64,${audioBase64}`
                          }
                        }
                      ]
                    }
                  ],
                  temperature: 0.1
                };

                const response = await fetch(`${targetUrl}/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(chatPayload),
                  signal: AbortSignal.timeout(60000)
                });

                if (response.ok) {
                  const data = await response.json();
                  const content = data.choices?.[0]?.message?.content;
                  if (content && typeof content === 'string' && content.trim()) {
                    transcribedText = content.trim();
                  }
                } else {
                  const errText = await response.text();
                  errors.push(`chat/completions data_uri (HTTP ${response.status}): ${errText.slice(0, 300)}`);
                }
              } catch (err) {
                errors.push(`chat/completions data_uri error: ${err.message}`);
              }
            }

            if (transcribedText) {
              sendJson(res, 200, { ok: true, text: transcribedText });
            } else {
              sendJson(res, 502, {
                ok: false,
                error: errors.join('; ') || 'Transcription failed across all attempts'
              });
            }
            return;
          }

          sendJson(res, 404, { ok: false, error: 'Route not found' });
        } catch (fatalError) {
          sendJson(res, 500, { ok: false, error: fatalError.message || String(fatalError) });
        }
      }
    });
  });
}
