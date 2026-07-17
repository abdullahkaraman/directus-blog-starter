import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { UseFormReturn } from 'react-hook-form';

interface SelectFieldProps {
	name: string;
	options: { value: string; text: string }[];
	placeholder?: string | null;
	form: UseFormReturn;
}

const SelectField = ({ name, options, placeholder, form }: SelectFieldProps) => {
	return (
		<Select onValueChange={(value) => form.setValue(name, value)} value={form.getValues(name)}>
			<SelectTrigger className="rounded-none border-0 border-b border-neutral-200 bg-white px-0 py-2 text-neutral-900 shadow-none focus:border-black focus:ring-0">
				<SelectValue placeholder={placeholder || 'Select an option'} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.text}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};

export default SelectField;
