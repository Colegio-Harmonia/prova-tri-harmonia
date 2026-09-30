import PlanEditor from './plan-editor'

export default async function PlanPage(props: { params: Promise<{ planId: string }> }) {
  const { planId } = await props.params
  return <PlanEditor planId={Number(planId)} />
}
