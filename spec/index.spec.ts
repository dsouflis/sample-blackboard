import { OpenAI } from 'openai';
import {Rete} from 'rete-next/index.js';
import { parseRete} from 'rete-next/productions0.js';

const openai = new OpenAI()

async function getOpenAiResponse(system: string, user: string) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{
      role: 'system',
      content: system,
    }, {
      role: 'user',
      content: user
    }]
  });
  return response.choices[0].message;
}

describe('The blackboard', () => {
  let rete: Rete;
  beforeEach(() => {
    rete = new Rete();
  })

  it('can initialize', () => {

  });
})
