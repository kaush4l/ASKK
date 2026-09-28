'use client'

import { useEffect } from 'react'
import Workbench from '../src/workbench/Workbench.jsx'

export default function WorkbenchBoot() {
  useEffect(() => {
    document.documentElement.dataset.askkBoot = 'ready'
    window.dispatchEvent(new Event('askk:hydrated'))
  }, [])
  return <Workbench />
}
