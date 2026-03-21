import { z } from "zod/v4";

export const TodoSchema = z.object({
  id: z.string().describe("Unique identifier"),
  title: z.string().describe("Todo title/description"),
  completed: z.boolean().describe("Whether the todo is done"),
  createdAt: z.string().describe("ISO timestamp of creation"),
  updatedAt: z.string().describe("ISO timestamp of last update"),
});

export type Todo = z.infer<typeof TodoSchema>;

export const CreateTodoInputSchema = z.object({
  title: z.string().describe("The todo title"),
});

export const GetTodoInputSchema = z.object({
  id: z.string().describe("Todo ID to retrieve"),
});

export const ListTodosInputSchema = z.object({
  completed: z.boolean().optional().describe("Filter by completion status"),
});

export const UpdateTodoInputSchema = z.object({
  id: z.string().describe("Todo ID to update"),
  title: z.string().optional().describe("New title"),
  completed: z.boolean().optional().describe("New completion status"),
});

export const DeleteTodoInputSchema = z.object({
  id: z.string().describe("Todo ID to delete"),
});

export type CreateTodoInput = z.infer<typeof CreateTodoInputSchema>;
export type GetTodoInput = z.infer<typeof GetTodoInputSchema>;
export type ListTodosInput = z.infer<typeof ListTodosInputSchema>;
export type UpdateTodoInput = z.infer<typeof UpdateTodoInputSchema>;
export type DeleteTodoInput = z.infer<typeof DeleteTodoInputSchema>;

export interface TodoResponse {
  todo: Todo;
}

export interface TodoListResponse {
  todos: Todo[];
}

export interface DeleteResponse {
  success: boolean;
}
