'use client';

import dynamic from 'next/dynamic';

import type { ComponentProps } from 'react';
import type FormBuilderType from '@/components/forms/FormBuilder';

const FormBuilder = dynamic(() => import('@/components/forms/FormBuilder'));

export default function FormIsland(props: ComponentProps<typeof FormBuilderType>) {
	return <FormBuilder {...props} />;
}
