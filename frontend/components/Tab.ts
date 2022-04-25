const tabs = ['train', 'predict', 'search', 'insights'] as const
export type Tab = typeof tabs[number]
export const isTab = (name: any): name is Tab => tabs.includes(name)
