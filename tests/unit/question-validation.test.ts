import { describe, expect, it } from 'vitest';
import { questionSetSchema } from '@/lib/validation/schemas';
const valid = { label:'fixture', phase:'MAIN' as const, questions:Array.from({length:5},(_,i)=>({ id:`q${i}`, prompt:'fixture', options:Array.from({length:4},(_,j)=>({ id:`q${i}o${j}`, text:'fixture', isCorrect:j===0 })) })) };
describe('question-set validation', () => {
  it('accepts exactly 5x4 with one correct each', () => expect(questionSetSchema.safeParse(valid).success).toBe(true));
  it('rejects two correct options', () => { const broken=structuredClone(valid); broken.questions[0].options[1].isCorrect=true; expect(questionSetSchema.safeParse(broken).success).toBe(false); });
});
