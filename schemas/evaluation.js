const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');

// Define individual category schema matching existing data model
const CategoryDetailSchema = z.object({
  score: z.number().min(1).max(10).describe('Score from 1-10'),
  feedback: z.string().describe('Brief feedback explaining the score')
});

// Define the complete evaluation response schema matching existing data structure
const EvaluationSchema = z.object({
  overall_score: z.number().min(1).max(10).describe('Overall score from 1-10'),
  key_improvements: z.array(z.string()).min(1).max(5).describe('Array of 2-3 key improvement suggestions'),
  categories: z.object({
    tone_empathy: CategoryDetailSchema.describe('Tone and empathy evaluation'),
    clarity_completeness: CategoryDetailSchema.describe('Clarity and completeness evaluation'),
    standard_of_english: CategoryDetailSchema.describe('English quality evaluation'),
    problem_resolution: CategoryDetailSchema.describe('Problem resolution evaluation')
  }).describe('Category-based evaluations with scores and feedback')
});

// Create the response format for OpenAI Structured Outputs
const evaluationResponseFormat = zodResponseFormat(
  EvaluationSchema,
  'evaluation_response'
);

module.exports = {
  EvaluationSchema,
  CategoryDetailSchema,
  evaluationResponseFormat
};
