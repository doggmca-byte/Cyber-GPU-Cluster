import { TasksScreen } from "@/components/tasks/TasksScreen";

// Центр Завдань — окремий екран (не bottom-sheet модал): контенту забагато
// (6 табів + прогрес-бар + список), щоб комфортно вміститись у bottom sheet
// разом з рештою модалок застосунку (Deposit/Withdraw/Language). Відкривається
// кнопкою "ЗАВДАННЯ" на Farm, а не через BottomNav — той навмисно лишається
// фіксованим на 5 основних табах.
export default function TasksPage() {
  return <TasksScreen />;
}
